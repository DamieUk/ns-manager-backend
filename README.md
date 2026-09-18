# Numenor Backend

Node.js + Express + MongoDB (Mongoose), TypeScript. RBAC, Google OAuth + email/password auth,
клієнти/замовлення/продукти/документи, польова шифрація чутливих полів (AES-256-GCM),
завантаження файлів у S3-сумісне сховище.

## Розробка

```bash
cp .env.example .env   # заповнити значення (Mongo, Google OAuth, SMTP, S3, секрети)
npm install
npm run dev             # tsx watch, http://localhost:5001
```

Локально MongoDB запускається окремо (наприклад `brew services start mongodb-community`),
`MONGODB_URI` за замовчуванням вказує на `mongodb://127.0.0.1:27017/numenor`.

Для файлів (контракти, BOM, фото до звітів) потрібне S3-сумісне сховище навіть у розробці —
дивись `.env.example` та розділ про Cloudflare R2 нижче.

## Структура

```
src/
  app.ts              # express app (middleware, CORS, роути)
  server.ts           # entrypoint (mongo connect + listen)
  config/             # db, passport, mailer, storage (S3)
  constants/          # ролі/дозволи
  controllers/        # логіка обробників
  routes/             # маршрути, змонтовані під /api
  middleware/         # requireAuth, requirePermission, upload, error handling
  models/             # mongoose-схеми
  utils/              # шифрування полів, токени, дати, HttpError
  scripts/            # seedExecutive.ts — створення першого executive-акаунта
```

## Деплой на Render

Репозиторій містить `render.yaml` (Blueprint) — Render сам підхопить build/start-команди та
health check (`/api/health`).

### 1. MongoDB Atlas

Render не має власного managed MongoDB.

1. Створити безкоштовний кластер на [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Database Access → створити користувача з паролем
3. Network Access → дозволити `0.0.0.0/0` (або звузити до Render IP пізніше)
4. Скопіювати рядок підключення (`mongodb+srv://...`) — це значення для `MONGODB_URI`

### 2. Сховище файлів (Cloudflare R2)

Контракти, BOM-файли та фото до звітів прогресу зберігаються в S3-сумісному сховищі
(не на диску бекенда — на Render він ефемерний). Рекомендовано Cloudflare R2 (безкоштовно
до 10 ГБ, без плати за вихідний трафік), але підійде будь-який S3-сумісний провайдер
(AWS S3, Backblaze B2, DigitalOcean Spaces) — просто інші значення нижче.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → R2 → Create bucket (наприклад `numenor-files`)
2. R2 → Manage API tokens → Create API token → права **Object Read & Write**, обмежені цим бакетом
3. Значення для `.env`/Render:
   - `S3_ENDPOINT` — `https://<account-id>.r2.cloudflarestorage.com` (account id видно в правій панелі R2)
   - `S3_REGION` — `auto`
   - `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — з токена
   - `S3_BUCKET` — назва бакета

### 3. Google OAuth (production redirect URI)

У [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth 2.0 Client →
**Authorized redirect URIs** додати `https://<backend-service>.onrender.com/api/auth/google/callback`
(точний домен буде відомий після кроку 4). Оновити `GOOGLE_CALLBACK_URL` цим самим значенням.

### 4. GitHub + Render

1. Запушити цей репозиторій у свій GitHub-акаунт
2. Render → New → Blueprint → обрати репозиторій → Render прочитає `render.yaml`
3. Ввести значення для змінних з `sync: false`: `MONGODB_URI`, `CLIENT_ORIGIN` (адреса
   задеплоєного клієнта, можна тимчасово залишити як є й оновити пізніше), `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `SESSION_SECRET`, `JWT_SECRET`, `SMTP_PASSWORD`,
   `FIELD_ENCRYPTION_PASSPHRASE` (згенерувати новий надійний секрет для продакшену — не той,
   що в локальному `.env`), `S3_*` з кроку 2
4. Deploy — після збірки бекенд буде на `https://<service-name>.onrender.com`, перевірити на `/api/health`

Безкоштовний план Render «засинає» після періоду неактивності — перший запит після паузи
може займати кілька секунд (холодний старт).

### 5. Перший executive-акаунт

Продакшн-база стартує чистою. Створити перший акаунт напряму в Atlas-базі:

```bash
MONGODB_URI="<production Atlas URI>" npm run seed:executive -- "damon@numenorsystems.com" "Damon Executive" "<google-email>"
```

(або додати тимчасовий npm-скрипт, що викликає `src/scripts/seedExecutive.ts` — дивись сам файл
щодо аргументів). Після цього решту акаунтів можна створювати вже через UI (сторінка
«Користувачі», запрошення на email або пряме встановлення пароля).
