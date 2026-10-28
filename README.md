# Mock HTTP Server

Локальный инструмент для mock HTTP API. Текущий результат — **этап A: каркас и контракты**. CRUD, mock engine, файловый watcher и редакторы ещё не реализованы. Полный план и принятые решения: [архитектура](docs/architecture.md).

## Запуск

Требуется Node.js 24 LTS и npm 11.

```sh
npm ci
cp .env.example .env
npm run dev
```

Frontend: http://127.0.0.1:5173. Vite проксирует `/api` на административный backend. Admin по умолчанию: http://127.0.0.1:3001, mock listener: http://127.0.0.1:4000. Mock listener пока возвращает диагностический 404.

```sh
npm run build
npm start
```

В production frontend обслуживается admin listener на порту 3001. Dev-порт 5173 не нужен. SIGINT/SIGTERM закрывает оба listener; ошибка запуска одного закрывает другой.

## Проверки

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

Используется пользовательский `eslint.config.js` на базе Antfu, включая форматирование. Prettier отсутствует.

## Конфигурация

Переменные `.env` загружаются при dev/start. ADMIN_HOST/ADMIN_PORT и MOCK_HOST/MOCK_PORT задают независимые адреса. PROJECTS_DIR — каталог проектов относительно корня репозитория (по умолчанию `./data/projects`), LOG_BUFFER_SIZE — лимит будущего журнала, MAX_BODY_SIZE — лимит HTTP body в байтах. Локальный host по умолчанию — `127.0.0.1`. Пути не зависят от cwd workspace.

Один проект — один JSON-файл с schemaVersion 1 и безопасным id. TypeScript-типы выводятся из Zod. Экспорт `projectJsonSchema` предназначен для Monaco. Проверки уникальности и межполевые ограничения дополнительно исполняются backend через Zod: JSON Schema не выражает все эти проверки.

Примеры: [Shop API](examples/shop.json), [CRM API](examples/crm.json). Они не копируются в пользовательские данные автоматически. После реализации storage их можно будет импортировать. `GET /shop/api/products?mode=error` выбирает условный HTTP 500, запрос без условия — default HTTP 200.

Ответ поддерживает status, contentType, headers, JSON body, fixed/random delay. Текстовые ответы требуют строку или null. Для генерации используются bodyMode `generated` и generation со схемой object/array/value; seed необязателен. В конфигурации не допускается JavaScript. Генератор будет реализован на этапе E.

Ручная остановка проекта не меняет autoStart. Работа с файлами, импорт/экспорт, watcher и ревизии запланированы на этап C; Docker — на этап G. История будет храниться только в памяти. MVP не включает авторизацию, БД, stateful сценарии, HTTP-клиент, proxy или mock WebSocket/SSE.

Транзитивные DOMPurify и KaTeX закреплены через npm overrides на исправленных версиях. Это не изменяет правила пользовательского ESLint-конфига.
