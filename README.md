# Numenor Backend

Node.js + Express + MySQL/MariaDB (Drizzle ORM), TypeScript. RBAC, власна авторизація (email +
пароль, сесії в httpOnly cookie), клієнти/замовлення/продукти/документи, польова шифрація
чутливих полів (AES-256-GCM), завантажені файли зберігаються на диску самого сервера. Сторонніх
сервісів для бази, файлів чи входу немає.

## Розробка

Потрібен MySQL 8+ або MariaDB 10.6+ з порожньою базою `numenor`.

```bash
cp .env.example .env    # DATABASE_URL, FIELD_ENCRYPTION_PASSPHRASE, за потреби SMTP
npm install
npm run dev             # tsx watch, http://localhost:5001
npm run seed:executive -- "you@example.com" "Ім'я Прізвище"   # перший акаунт; виведе пароль
```

- Таблиці створюються автоматично: при старті сервер застосовує міграції з `drizzle/`.
- Файли (контракти, BOM, фото до звітів) пишуться в `./uploads` (або в `UPLOAD_DIR`). Тека в `.gitignore`.
- Без SMTP листи (запрошення, відновлення пароля) не надсилаються, а посилання з них виводиться
  в консоль сервера — так інвайти працюють і локально. На продакшені без SMTP лист просто не піде.

## Тести

```bash
npm test
```

Тест піднімає окремий сервер на тестовій базі `numenor_test` (стирається перед кожним запуском) з
тимчасовою текою для файлів і проходить API від імені executive, менеджера й працівників —
~240 запитів: вхід і сесії, ролі та дозволи, валідація, файли, звіти, дашборд, видалення. Кожна
відповідь порівнюється з еталоном `test/golden.json` (id, час і назви файлів у сховищі замінено
плейсхолдерами). Потрібен локальний MySQL з `root` без пароля на `127.0.0.1:3306` (або
`TEST_MYSQL_URL=mysql://user:pass@host:port`).

Якщо поведінку API змінено свідомо — перезаписати еталон і переглянути diff:

```bash
UPDATE_GOLDEN=1 npm test && git diff test/golden.json
```

## База даних

- Схема — `src/db/schema.ts`, SQL-міграції — `drizzle/`. Після зміни схеми: `npm run db:generate`
  і закомітити новий файл міграції. У нових `CREATE TABLE` дописати вручну
  `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin` (як у `0000_init.sql`):
  drizzle-kit не вміє table options, а без цього на хостингу таблиця може отримати latin1.
- Id — 24-символьні hex-рядки (у форматі, який клієнт отримував завжди).
- Посилання між записами — звичайні колонки без foreign keys: як і раніше, видалення запису
  залишає посилання на нього, а читання такі записи пропускає.
- SQL сумісний і з MySQL 8, і з MariaDB 10.6+ (без JSON-колонок тощо).

## Авторизація

- Вхід лише email + пароль (`POST /api/auth/login`). Нових користувачів запрошують зі сторінки
  «Користувачі» (лист з посиланням на встановлення пароля) або задають пароль напряму.
- Після входу бекенд створює сесію (таблиця `sessions`, зберігається лише SHA-256 хеш токена) і
  ставить cookie `numenor_session`: `httpOnly`, `SameSite=Strict`, `Path=/api`, `Secure` у
  продакшені. Тривалість — `SESSION_TTL_HOURS` (за замовчуванням 12 год).
- `POST /api/auth/logout` видаляє сесію. Усі сесії користувача відкликаються при зміні/скиданні
  пароля, деактивації та видаленні акаунта.
- Захист від CSRF: `SameSite=Strict` + перевірка заголовка `Origin` на всіх змінюючих запитах
  (має збігатися з `CLIENT_ORIGIN`).
- Ліміт спроб: 10 невдалих входів на IP за 15 хв; так само для forgot/reset/accept-invite.

## Структура

```
src/
  app.ts              # express app (middleware, CORS, роути)
  server.ts           # entrypoint (підключення до БД + міграції + listen)
  db/                 # підключення, схема (Drizzle), генератор id, впорядковані списки
  models/             # доступ до даних по сутностях + формат відповідей
  config/             # mailer, storage (локальний диск)
  constants/          # ролі/дозволи
  controllers/        # логіка обробників
  routes/             # маршрути, змонтовані під /api
  middleware/         # requireAuth, requirePermission, upload, verifyOrigin, error handling
  utils/              # шифрування полів, токени, сесії, валідація, дати, HttpError
  scripts/            # seedExecutive.ts — створення першого executive-акаунта
drizzle/              # SQL-міграції (застосовуються при старті)
test/                 # API-тест і еталон golden.json
deploy/               # docker-compose для VPS (MySQL + API + клієнт + Caddy), бекап
```

## Деплой

Два варіанти. Обидва тримають базу й файли на тому ж сервері — **бекапи обов'язкові**.

### Варіант A: Spaceship Web Hosting (cPanel)

Бекенд працює як Node.js-застосунок cPanel на піддомені `api.<домен>`, клієнт — статичні файли на
основному домені. Піддомен того ж домену — це «той самий сайт» для браузера, тому cookie-сесія з
`SameSite=Strict` працює, а CORS дозволено лише для `CLIENT_ORIGIN`.

Перевірити в cPanel заздалегідь: у «Setup Node.js App» доступна версія Node.js **20 або новіша**;
база — MySQL 8 або MariaDB 10.6+ (версія видна в phpMyAdmin).

**1. Піддомен.** cPanel → Domains: створити `api.<домен>`. Клієнт — на `<домен>` (`public_html`).
SSL для обох видає AutoSSL (cPanel → SSL/TLS Status).

**2. База.** cPanel → MySQL Databases: створити базу (наприклад `<cpuser>_numenor`), користувача
з паролем **лише з літер і цифр** (пароль іде в URL), додати користувача до бази з ALL PRIVILEGES.

**3. Зібрати локально.**

```bash
# бекенд
npm ci && npm run build
zip -r numenor-api.zip dist drizzle package.json package-lock.json

# клієнт (у ns-manager-client)
VITE_API_URL=https://api.<домен>/api npm run build    # результат — dist/ (разом з .htaccess)
```

**4. Залити бекенд.** cPanel → File Manager: у домашній теці створити `numenor-api`, завантажити
й розпакувати туди `numenor-api.zip`. Поруч створити теку `numenor-uploads` (поза `public_html`).
У `numenor-api` створити файл `.env` (права 600):

```
NODE_ENV=production
DATABASE_URL=mysql://<db-user>:<db-password>@localhost:3306/<cpuser>_numenor
CLIENT_ORIGIN=https://<домен>
UPLOAD_DIR=/home/<cpuser>/numenor-uploads
FIELD_ENCRYPTION_PASSPHRASE=<openssl rand -hex 32>
SESSION_TTL_HOURS=12
SMTP_HOST=mail.spacemail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=damon@numenorsystems.com
SMTP_PASSWORD=<пароль поштової скриньки>
SMTP_FROM="Numenor Systems <damon@numenorsystems.com>"
```

`FIELD_ENCRYPTION_PASSPHRASE` — новий секрет, **зберегти в надійному місці**: без нього
зашифровані поля в базі (і в бекапах) не прочитати. Не змінювати після запуску.

**5. Node.js-застосунок.** cPanel → Setup Node.js App → Create Application:
Node.js — найновіша доступна (≥ 20), Application mode — Production, Application root —
`numenor-api`, Application URL — `api.<домен>`, startup file — `dist/server.js`. Create →
Run NPM Install → Restart. Таблиці створяться при першому старті.

Перевірка: `https://api.<домен>/api/health` → `"database":"connected"`, а в полі `ip` — ваша
справжня публічна IP-адреса. Якщо там `127.0.0.1` чи адреса самого сервера, ліміт спроб входу
буде спільним для всіх — тоді треба з'ясувати в підтримки, як хостинг передає IP відвідувача.

**6. Перший акаунт.** cPanel → Terminal: виконати команду входу у віртуальне оточення (її
показано вгорі сторінки застосунку в Setup Node.js App), далі:

```bash
cd ~/numenor-api && node dist/scripts/seedExecutive.js "damon@numenorsystems.com" "Ім'я Прізвище"
```

Скрипт виведе згенерований пароль. Решту акаунтів — через сторінку «Користувачі».

**7. Клієнт.** Завантажити **вміст** `ns-manager-client/dist/` у `public_html`, включно з
`.htaccess` (у File Manager — Settings → Show Hidden Files). Відкрити `https://<домен>`.

**8. Бекапи.** Найпростіше — cPanel → Backup: повний бекап акаунта містить і базу, і
`numenor-uploads`; регулярно завантажувати його собі. Автоматично — cPanel → Cron Jobs, щоночі
(доступ до бази — у файлі `~/.my.cnf` з правами 600: `[client]` / `user=…` / `password=…`):

```bash
mkdir -p ~/backups && mysqldump --defaults-extra-file=$HOME/.my.cnf --single-transaction --no-tablespaces <cpuser>_numenor | gzip > ~/backups/db-$(date +\%F).sql.gz && tar -czf ~/backups/uploads-$(date +\%F).tar.gz -C ~ numenor-uploads && find ~/backups -mtime +14 -delete
```

Бекап на тому ж хостингу не захищає від втрати акаунта — копії варто періодично забирати собі.

**Оновлення.** Локально знову крок 3; залити новий `dist/` (і `drizzle/`, `package*.json`, якщо
змінювались) у `numenor-api`, при зміні залежностей — Run NPM Install, далі Restart. Нові
міграції застосуються при старті. Клієнт — замінити вміст `public_html` новим `dist/`.

### Варіант B: VPS з Docker

Увесь стек працює на одному сервері в Docker: MySQL, бекенд, статичний клієнт і Caddy, який
автоматично отримує й оновлює HTTPS-сертифікат (Let's Encrypt). Клієнт і API живуть на одному
домені (`https://<домен>/` і `https://<домен>/api`).

```
Інтернет → Caddy :443 ─┬─ /api/*  → api (Node, :5001) ─┬─ db: MySQL (volume db-data)
                       │                               └─ uploads (volume uploads)
                       └─ решта   → web (статичний SPA)
```

**1. Сервер і домен.** VPS з Ubuntu 24.04, мінімум 2 vCPU / 4 GB RAM / 40 GB SSD (регіон — ЄС;
4 GB — бо на сервері збираються образи й працює MySQL). У DNS — **A-запис** домену на IP сервера.

**2. Підготовка сервера.**

```bash
ssh root@<IP>
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh          # Docker + compose plugin
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

Назовні публікуються лише 80/443 (Caddy). MySQL і бекенд доступні тільки всередині Docker-мережі.

**3. Код.** Обидва репозиторії поруч — `docker-compose.yml` збирає клієнт з `../../ns-manager-client`:

```bash
mkdir -p /opt/numenor && cd /opt/numenor
git clone git@github.com:DamieUk/ns-manager-backend.git
git clone git@github.com:DamieUk/ns-manager-client.git
```

**4. Налаштування.**

```bash
cd /opt/numenor/ns-manager-backend/deploy
cp .env.example .env && nano .env
```

- `DOMAIN` — домен з кроку 1
- `DB_PASSWORD`, `DB_ROOT_PASSWORD` — `openssl rand -hex 24`
- `FIELD_ENCRYPTION_PASSPHRASE` — новий секрет, **зберегти в надійному місці** (див. варіант A)
- `SMTP_PASSWORD` — для листів-запрошень і відновлення пароля

`CLIENT_ORIGIN`, `DATABASE_URL` і `UPLOAD_DIR` задає `docker-compose.yml`.

**5. Запуск.**

```bash
docker compose up -d --build
docker compose ps                      # усі сервіси running/healthy
curl https://<DOMAIN>/api/health       # "database":"connected"
docker compose exec api node dist/scripts/seedExecutive.js "damon@numenorsystems.com" "Ім'я Прізвище"
```

**6. Бекапи.** Щоночі о 03:15, зберігаються 14 днів у `/var/backups/numenor`:

```bash
crontab -e
15 3 * * * /opt/numenor/ns-manager-backend/deploy/backup.sh >> /var/log/numenor-backup.log 2>&1
```

Копіювати `/var/backups/numenor` ще кудись (`rsync` на інший сервер / Storage Box) та/або
увімкнути знімки сервера в панелі провайдера. Відновлення (з теки `deploy/`):

```bash
B=/var/backups/numenor/<дата>
gunzip -c $B/db.sql.gz | docker compose exec -T db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" numenor'
docker compose exec -T api tar -C /app/uploads -xzf - < $B/uploads.tar.gz
```

**Оновлення.**

```bash
cd /opt/numenor/ns-manager-backend && git pull
cd /opt/numenor/ns-manager-client && git pull
cd /opt/numenor/ns-manager-backend/deploy && docker compose up -d --build && docker image prune -f
```

Дані (`db-data`, `uploads`, сертифікати) лежать у Docker volumes і переживають перезбірку.
**Не** виконувати `docker compose down -v` — це видалить volumes разом з базою та файлами.

Корисне: `docker compose logs -f api`, `docker compose restart api`,
`docker compose exec db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" numenor'`.
