export interface SecretStore { get(name: string): Promise<string | undefined>; set(name: string, value: string): Promise<void>; remove(name: string): Promise<void>; }
/** Windows integration boundary. A production adapter must use Credential Manager; no fallback persists secrets to disk. */
import { spawn } from "node:child_process";
const script = String.raw`
Add-Type @'
using System; using System.Runtime.InteropServices;
public class Cred { [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct C { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint BlobSize; public IntPtr Blob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
[DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, uint type, uint flags, out IntPtr ptr); [DllImport("Advapi32.dll", SetLastError=true)] public static extern void CredFree(IntPtr ptr); [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredWrite(ref C credential, uint flags); [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredDelete(string target, uint type, uint flags);
public static string Read(string target) { IntPtr ptr; if(!CredRead(target,1,0,out ptr)) { int error=Marshal.GetLastWin32Error(); if(error==1168) return null; throw new Exception("Credential Manager read failed: "+error); } try { C c=(C)Marshal.PtrToStructure(ptr,typeof(C)); return c.BlobSize==0 ? "" : Marshal.PtrToStringUni(c.Blob,(int)c.BlobSize/2); } finally { CredFree(ptr); } }
public static bool Write(string target,string value) { byte[] bytes=System.Text.Encoding.Unicode.GetBytes(value); IntPtr blob=Marshal.AllocCoTaskMem(bytes.Length); try { Marshal.Copy(bytes,0,blob,bytes.Length); C c=new C(); c.Type=1; c.TargetName=target; c.UserName="mcp-insta"; c.Persist=2; c.Blob=blob; c.BlobSize=(uint)bytes.Length; if(!CredWrite(ref c,0)) throw new Exception("Credential Manager write failed: "+Marshal.GetLastWin32Error()); return true; } finally { Marshal.FreeCoTaskMem(blob); } }
}
'@
$credentialRequest = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($credentialRequest.action -eq 'get') { $v=[Cred]::Read($credentialRequest.name); if ($null -ne $v) { [Console]::Out.Write($v) } }
if ($credentialRequest.action -eq 'set') { if (-not [Cred]::Write($credentialRequest.name,$credentialRequest.value)) { throw 'Не удалось записать секрет в Credential Manager.' } }
if ($credentialRequest.action -eq 'remove') { [void][Cred]::CredDelete($credentialRequest.name,1,0) }
`;
function call(input: Record<string, string>): Promise<string> { return new Promise((resolve, reject) => { const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true}); let out="",err=""; child.stdout.on("data",(v)=>out+=v); child.stderr.on("data",(v)=>err+=v); child.on("error",reject); child.on("close",(code)=>code===0?resolve(out):reject(new Error(err || `Credential Manager завершился с кодом ${code}.`))); child.stdin.end(JSON.stringify(input)); }); }
export class WindowsCredentialManager implements SecretStore { async get(name: string) { const value=await call({action:"get",name}); return value || undefined; } async set(name: string, value: string) { await call({action:"set",name,value}); } async remove(name: string) { await call({action:"remove",name}); } }
