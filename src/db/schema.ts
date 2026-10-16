import { boolean, char, datetime, decimal, index, int, mysqlTable, primaryKey, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

// Ids are 24-character hex strings (time-ordered, like the MongoDB ObjectIds the API has always
// returned). References are plain columns without foreign keys on purpose: as before, deleting a
// record leaves references to it in place and readers skip the missing record.
const id = () => char('id', { length: 24 }).primaryKey();
const ref = (name: string) => char(name, { length: 24 });
const stamp = (name: string) => datetime(name, { mode: 'date', fsp: 3 });
const money = (name: string) => decimal(name, { precision: 14, scale: 2, mode: 'number' });
const timestamps = () => ({
  createdAt: stamp('created_at').notNull(),
  updatedAt: stamp('updated_at').notNull(),
});

// Fields marked "encrypted" hold AES-256-GCM ciphertext (utils/fieldEncryption).

export const users = mysqlTable(
  'users',
  {
    id: id(),
    firstName: text('first_name').notNull(), // encrypted
    lastName: text('last_name').notNull(), // encrypted
    jobTitle: text('job_title').notNull(), // encrypted
    phone: text('phone').notNull(), // encrypted
    address: text('address').notNull(), // encrypted
    status: varchar('status', { length: 16 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    role: varchar('role', { length: 16 }).notNull(),
    permissions: text('permissions').notNull(), // JSON array of { key, action }
    avatarUrl: text('avatar_url'),
    isActive: boolean('is_active').notNull(),
    passwordHash: varchar('password_hash', { length: 255 }),
    emailVerified: boolean('email_verified').notNull(),
    passwordTokenHash: char('password_token_hash', { length: 64 }),
    passwordTokenExpires: stamp('password_token_expires'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('email').on(t.email), index('users_password_token_hash').on(t.passwordTokenHash)]
);

export const sessions = mysqlTable(
  'sessions',
  {
    tokenHash: char('token_hash', { length: 64 }).primaryKey(),
    userId: ref('user_id').notNull(),
    expiresAt: stamp('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [index('sessions_user_id').on(t.userId), index('sessions_expires_at').on(t.expiresAt)]
);

export const clients = mysqlTable(
  'clients',
  {
    id: id(),
    name: text('name').notNull(),
    code: varchar('code', { length: 255 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    contactName: text('contact_name'), // encrypted
    email: text('email'), // encrypted
    phone: text('phone'), // encrypted
    address: text('address'), // encrypted
    notes: text('notes'), // encrypted
    // Requisites for generated invoices and delivery notes (all encrypted).
    legalName: text('legal_name'),
    edrpou: text('edrpou'), // ЄДРПОУ (8 digits) or a sole trader's ІПН (10 digits)
    legalAddress: text('legal_address'),
    iban: text('iban'),
    bankName: text('bank_name'),
    vatNumber: text('vat_number'), // ІПН платника ПДВ
    signatory: text('signatory'), // who signs on the client's side, e.g. «Директор Іваненко І. І.»
    ...timestamps(),
  },
  (t) => [uniqueIndex('code').on(t.code)]
);

export const documents = mysqlTable(
  'documents',
  {
    id: id(),
    clientId: ref('client_id').notNull(),
    filename: varchar('filename', { length: 255 }).notNull(), // storage key in UPLOAD_DIR
    originalName: text('original_name').notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    size: int('size').notNull(),
    type: varchar('type', { length: 32 }).notNull().default('other'), // see DOCUMENT_TYPES
    uploadedBy: ref('uploaded_by').notNull(),
    ...timestamps(),
  },
  (t) => [index('documents_client_id').on(t.clientId)]
);

export const contracts = mysqlTable(
  'contracts',
  {
    id: id(),
    title: text('title').notNull(),
    clientId: ref('client_id').notNull(),
    type: varchar('type', { length: 16 }).notNull().default('framework'), // nda | framework | annex
    number: varchar('number', { length: 64 }),
    signedAt: stamp('signed_at'),
    orderId: ref('order_id'), // the batch an annex covers
    startDate: stamp('start_date'),
    endDate: stamp('end_date'),
    status: varchar('status', { length: 16 }).notNull(),
    notes: text('notes'), // encrypted
    ...timestamps(),
  },
  (t) => [index('contracts_client_id').on(t.clientId), index('contracts_order_id').on(t.orderId)]
);

export const contractDocuments = mysqlTable(
  'contract_documents',
  {
    contractId: ref('contract_id').notNull(),
    position: int('position').notNull(),
    documentId: ref('document_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.contractId, t.position] })]
);

export const products = mysqlTable(
  'products',
  {
    id: id(),
    clientId: ref('client_id').notNull(),
    name: text('name').notNull(),
    sku: varchar('sku', { length: 255 }).notNull(),
    type: varchar('type', { length: 16 }).notNull(),
    description: text('description'), // encrypted
    bomFileId: ref('bom_file_id'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('sku').on(t.sku), index('products_client_id').on(t.clientId)]
);

export const productFiles = mysqlTable(
  'product_files',
  {
    productId: ref('product_id').notNull(),
    position: int('position').notNull(),
    documentId: ref('document_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.position] })]
);

// An order is a batch (партія): one annex to the framework contract, one price, moving through
// the stages in ORDER_STAGES. `status` follows the stage (active / completed / cancelled).
export const orders = mysqlTable(
  'orders',
  {
    id: id(),
    number: varchar('number', { length: 16 }).notNull(), // «26-001»: two-digit year, sequence within it
    clientId: ref('client_id').notNull(),
    productId: ref('product_id').notNull(),
    quantity: int('quantity').notNull(),
    description: text('description').notNull(), // encrypted
    status: varchar('status', { length: 16 }).notNull(),
    stage: varchar('stage', { length: 16 }).notNull().default('quote'),
    stageChangedAt: stamp('stage_changed_at').notNull(),
    dueDate: stamp('due_date'),
    managerId: ref('manager_id'),
    // The quote is priced in the client's currency; once agreed, the batch is fixed in UAH.
    quoteAmount: money('quote_amount'), // whole batch, in quoteCurrency
    quoteCurrency: varchar('quote_currency', { length: 3 }),
    exchangeRate: decimal('exchange_rate', { precision: 12, scale: 4, mode: 'number' }), // UAH per 1 quoteCurrency
    priceUah: money('price_uah'), // the agreed batch price for the annex and invoices
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('orders_number').on(t.number),
    index('orders_client_id').on(t.clientId),
    index('orders_status').on(t.status),
    index('orders_stage').on(t.stage),
  ]
);

// Every stage change of a batch, oldest first; `fromStage` is null for the batch's creation.
export const orderStageEvents = mysqlTable(
  'order_stage_events',
  {
    id: id(),
    orderId: ref('order_id').notNull(),
    fromStage: varchar('from_stage', { length: 16 }),
    toStage: varchar('to_stage', { length: 16 }).notNull(),
    userId: ref('user_id'), // null for changes made by a migration
    note: text('note'), // encrypted
    createdAt: stamp('created_at').notNull(),
  },
  (t) => [index('order_stage_events_order_id').on(t.orderId)]
);

export const orderEmployees = mysqlTable(
  'order_employees',
  {
    orderId: ref('order_id').notNull(),
    position: int('position').notNull(),
    userId: ref('user_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.position] }), index('order_employees_user_id').on(t.userId)]
);

export const orderDocuments = mysqlTable(
  'order_documents',
  {
    orderId: ref('order_id').notNull(),
    position: int('position').notNull(),
    documentId: ref('document_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.position] })]
);

export const dailyProgress = mysqlTable(
  'daily_progress',
  {
    id: id(),
    employeeId: ref('employee_id').notNull(),
    orderId: ref('order_id').notNull(),
    date: stamp('date').notNull(), // UTC midnight of the reported day
    completed: int('completed').notNull(),
    needsRework: int('needs_rework').notNull(),
    partiallyAssembled: int('partially_assembled').notNull(),
    notes: text('notes'), // encrypted
    photoId: ref('photo_id'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('employee_order_date').on(t.employeeId, t.orderId, t.date),
    index('daily_progress_order_id').on(t.orderId),
    index('daily_progress_date').on(t.date),
  ]
);
