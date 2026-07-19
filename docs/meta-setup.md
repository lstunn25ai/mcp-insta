# Настройка Meta App

MCP рассчитан на одну подтверждённую связку Facebook Page → Instagram professional account.

## OAuth permissions

OAuth запрашивает только следующие права:

- `instagram_basic`
- `instagram_manage_insights`
- `instagram_manage_comments`
- `instagram_manage_messages`
- `pages_show_list`
- `pages_read_engagement`

После callback сервер получает список доступных Pages и сохраняет привязку только если находит ровно один связанный профессиональный Instagram аккаунт, совпадающий с необязательным `expected_instagram_username`.

## Хранение данных

- App ID и App Secret: Windows Credential Manager.
- User access token и Page access token: Windows Credential Manager.
- Идентификатор Instagram аккаунта и Page: локальный SQLite.

Ни один токен не выводится MCP-инструментом и не должен попадать в логи или документацию.
