# Numenor Backend

Node.js + Express + MongoDB (Mongoose), TypeScript. RBAC, власна авторизація (email + пароль,
сесії в httpOnly cookie), клієнти/замовлення/продукти/документи, польова шифрація чутливих полів
(AES-256-GCM), завантажені файли зберігаються на диску самого сервера.

## Розробка

```bash
cp .env.example .env   # заповнити значення (Mongo, SMTP, FIELD_ENCRYPTION_PASSPHRASE)
npm install
npm run dev             # tsx watch, http://localhost:5001
```

Локально MongoDB запускається окремо (наприклад `brew services start mongodb-community`),
`MONGODB_URI` за замовчуванням вказує на `mongodb://127.0.0.1:27017/numenor`.

Файли (контракти, BOM, фото до звітів) пишуться в `./uploads` (або в `UPLOAD_DIR`, якщо задано).
Тека в `.gitignore`.

Перший акаунт: `npm run seed:executive -- "you@example.com" "Ім'я Прізвище"` — скрипт виведе
згенерований пароль.

## Авторизація

- Вхід лише email + пароль (`POST /api/auth/login`). Нових користувачів запрошують зі сторінки
  «Користувачі» (лист з посиланням на встановлення пароля) або задають пароль напряму.
- Після входу бекенд створює сесію (колекція `sessions`, зберігається лише SHA-256 хеш токена)
  і ставить cookie `numenor_session`: `httpOnly`, `SameSite=Strict`, `Path=/api`, `Secure` у
  продакшені. Тривалість — `SESSION_TTL_HOURS` (за замовчуванням 12 год); прострочені сесії
  MongoDB видаляє сама (TTL-індекс).
- `POST /api/auth/logout` видаляє сесію. Усі сесії користувача відкликаються при зміні/скиданні
  пароля, деактивації та видаленні акаунта.
- Захист від CSRF: `SameSite=Strict` + перевірка заголовка `Origin` на всіх змінюючих запитах
  (має збігатися з `CLIENT_ORIGIN`).
- Ліміт спроб: 10 невдалих входів на IP за 15 хв; так само для forgot/reset/accept-invite.

## Структура

```
src/
  app.ts              # express app (middleware, CORS, роути)
  server.ts           # entrypoint (mongo connect + listen)
  config/             # db, passport, mailer, storage (локальний диск)
  constants/          # ролі/дозволи
  controllers/        # логіка обробників
  routes/             # маршрути, змонтовані під /api
  middleware/         # requireAuth, requirePermission, upload, error handling
  models/             # mongoose-схеми
  utils/              # шифрування полів, токени, дати, HttpError
  scripts/            # seedExecutive.ts — створення першого executive-акаунта
deploy/
  docker-compose.yml  # увесь стек: MongoDB + API + клієнт + Caddy (HTTPS)
  Caddyfile           # /api/* → бекенд, решта → клієнт
  .env.example        # продакшн-змінні
  backup.sh           # бекап бази та файлів
```

## Деплой на власний сервер (VPS)

Увесь стек працює на одному сервері в Docker: MongoDB, бекенд, статичний клієнт і Caddy, який
автоматично отримує й оновлює HTTPS-сертифікат (Let's Encrypt). Клієнт і API живуть на одному
домені (`https://<домен>/` і `https://<домен>/api`), тому CORS не потрібен. Сторонніх сервісів
для бази чи файлів немає — усе на диску сервера.

```
Інтернет → Caddy :443 ─┬─ /api/*  → api (Node, :5001) ─┬─ mongo (volume mongo-data)
                       │                               └─ uploads (volume uploads)
                       └─ решта   → web (статичний SPA)
```

### 1. Сервер і домен

- VPS з Ubuntu 24.04, мінімум 2 vCPU / 4 GB RAM / 40 GB SSD (будь-який провайдер: Hetzner,
  DigitalOcean, Contabo тощо; регіон — ЄС). 4 GB потрібні, бо на сервері збираються образи
  і працює MongoDB.
- У DNS домену створити **A-запис** (наприклад `app.numenorsystems.com`) на IP сервера.
  Без цього Caddy не отримає сертифікат.

### 2. Підготовка сервера

```bash
ssh root@<IP>
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh          # Docker + compose plugin
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

Назовні публікуються лише порти 80/443 (Caddy). MongoDB і бекенд доступні тільки всередині
Docker-мережі.

### 3. Код

Обидва репозиторії мають лежати поруч — `docker-compose.yml` збирає клієнт з `../../ns-manager-client`:

```bash
mkdir -p /opt/numenor && cd /opt/numenor
git clone git@github.com:DamieUk/ns-manager-backend.git
git clone git@github.com:DamieUk/ns-manager-client.git
```

(Для приватних репозиторіїв — додати на сервері SSH-ключ як Deploy key у GitHub.)

### 4. Налаштування

```bash
cd /opt/numenor/ns-manager-backend/deploy
cp .env.example .env
nano .env
```

- `DOMAIN` — домен з кроку 1
- `MONGO_ROOT_PASSWORD` — `openssl rand -hex 24`
- `FIELD_ENCRYPTION_PASSPHRASE` — новий надійний секрет (не той, що в локальному `.env`).
  **Зберегти в надійному місці**: без нього зашифровані поля в базі (і в бекапах) не прочитати.
- `SMTP_PASSWORD` — для листів-запрошень і відновлення пароля

`CLIENT_ORIGIN`, `MONGODB_URI` і `UPLOAD_DIR` виводяться автоматично в `docker-compose.yml`
з `DOMAIN` та паролю Mongo.

### 5. Запуск

```bash
cd /opt/numenor/ns-manager-backend/deploy
docker compose up -d --build
docker compose ps                      # усі сервіси running/healthy
curl https://<DOMAIN>/api/health       # {"status":"ok",...,"mongo":"connected"}
```

### 6. Перший executive-акаунт

База стартує порожньою:

```bash
docker compose exec api node dist/scripts/seedExecutive.js "damon@numenorsystems.com" "Damon Executive"
```

Скрипт виведе згенерований пароль — зберегти його й увійти. Далі акаунти створюються через UI
(сторінка «Користувачі»).

### 7. Бекапи

Файли й база тепер лише на цьому сервері — бекапи обов'язкові.

```bash
crontab -e
# щоночі о 03:15, зберігаються 14 днів у /var/backups/numenor
15 3 * * * /opt/numenor/ns-manager-backend/deploy/backup.sh >> /var/log/numenor-backup.log 2>&1
```

Бекап на тому ж сервері не захищає від втрати самого сервера — варто додатково копіювати
`/var/backups/numenor` на інше сховище (`rsync` на інший сервер / Storage Box) та/або увімкнути
автоматичні знімки сервера в панелі провайдера.

Відновлення з бекапу (з теки `deploy/`):

```bash
B=/var/backups/numenor/<дата>
docker compose exec -T mongo sh -c 'mongorestore -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip --drop' < $B/mongo.archive.gz
docker compose exec -T api tar -C /app/uploads -xzf - < $B/uploads.tar.gz
```

### Оновлення

```bash
cd /opt/numenor/ns-manager-backend && git pull
cd /opt/numenor/ns-manager-client && git pull
cd /opt/numenor/ns-manager-backend/deploy && docker compose up -d --build
docker image prune -f
```

Дані (`mongo-data`, `uploads`, сертифікати) лежать у Docker volumes і переживають перезбірку.
**Не** виконувати `docker compose down -v` — це видалить volumes разом з базою та файлами.

### Корисне

```bash
docker compose logs -f api             # логи бекенда
docker compose restart api
docker compose exec mongo sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" numenor --authenticationDatabase admin'
```
