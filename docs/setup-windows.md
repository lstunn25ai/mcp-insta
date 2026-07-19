# Настройка в Windows

1. Используйте профессиональный Instagram Creator или Business аккаунт и свяжите его с отдельной Facebook Page.
2. В Meta App включите Facebook Login for Business и добавьте `http://localhost:8787/callback` в список valid redirect URI.
3. В Windows Credential Manager создайте generic credentials `mcp-insta/app-id` и `mcp-insta/app-secret`.
4. Установите зависимости и соберите проект: `npm ci`, затем `npm run build`.
5. Укажите `dist/index.js` в конфигурации MCP-клиента.
6. Только после подтверждения владельца запустите `insta_auth_start`, завершите вход в браузере и вызовите `insta_auth_complete`.
7. Выполните `insta_diagnose`, затем используйте только подтверждённые возможности.

Токены, пароль, 2FA-коды, cookie и содержание Direct не сохраняются в конфигурации проекта.
