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
