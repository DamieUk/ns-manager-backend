# Numenor Backend

Node.js + Express + MongoDB (Mongoose) API.

## Розробка

```bash
cp .env.example .env   # налаштувати MONGODB_URI, PORT, CLIENT_ORIGIN
npm install
npm run dev            # nodemon, http://localhost:5000
```

## Структура

```
src/
  app.js              # express app (middleware, routes)
  server.js           # entrypoint (mongo connect + listen)
  config/db.js        # підключення до MongoDB
  models/             # mongoose-схеми
  controllers/        # логіка обробників (зараз — заглушки)
  routes/             # маршрути, змонтовані під /api
  middleware/         # notFound, errorHandler
```

## Маршрути

- `GET /api/health` — статус сервера та підключення до Mongo
- `GET|POST|PUT|DELETE /api/users(/:id)` — заглушки CRUD (501 Not Implemented)
- `POST /api/auth/register`, `POST /api/auth/login` — заглушки (501 Not Implemented)

## Деплой на Render

Репозиторій вже містить `render.yaml` (Blueprint), тож Render сам підхопить налаштування build/start-команд і health check.

1. **MongoDB Atlas** (Render не має власного managed MongoDB):
   - Створити безкоштовний кластер на [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
   - Database Access → створити користувача з паролем
   - Network Access → дозволити доступ з `0.0.0.0/0` (або пізніше звузити до Render IP)
   - Скопіювати рядок підключення (`mongodb+srv://...`)

2. **GitHub**: запушити цей репозиторій у свій GitHub-акаунт (`git remote add origin ...`, `git push -u origin main`)

3. **Render**:
   - New → Blueprint → обрати цей репозиторій → Render прочитає `render.yaml`
   - При створенні буде запропоновано ввести значення для змінних з `sync: false`:
     - `MONGODB_URI` — рядок підключення з Atlas
     - `CLIENT_ORIGIN` — адреса задеплоєного фронтенду (наприклад, `https://<username>.github.io`)
   - `PORT` Render підставляє сам — код вже читає `process.env.PORT`
   - Deploy — після збірки бекенд буде доступний на `https://<service-name>.onrender.com`, перевірити можна на `/api/health`

Безкоштовний план Render "засинає" після періоду неактивності — перший запит після паузи може займати кілька секунд (холодний старт).
