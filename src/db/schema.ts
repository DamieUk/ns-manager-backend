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
    // Prices are per board, without VAT. The quote is in the client's currency; once agreed, the
    // batch is fixed in UAH: invoices and delivery notes show quantity × unitPrice, VAT on top.
    unitQuote: money('unit_quote'), // in quoteCurrency
    quoteCurrency: varchar('quote_currency', { length: 3 }),
    exchangeRate: decimal('exchange_rate', { precision: 12, scale: 4, mode: 'number' }), // UAH per 1 quoteCurrency
    unitPrice: money('unit_price'), // UAH
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

// Our own company's requisites for generated invoices and delivery notes: a single row, id 'main'.
export const company = mysqlTable('company', {
  id: varchar('id', { length: 16 }).primaryKey(),
  name: text('name').notNull(), // short name, e.g. «Numenor Systems»
  legalName: text('legal_name'),
  edrpou: varchar('edrpou', { length: 10 }),
  legalAddress: text('legal_address'),
  iban: varchar('iban', { length: 34 }),
  bankName: text('bank_name'),
  bankMfo: varchar('bank_mfo', { length: 6 }), // МФО
  bankEdrpou: varchar('bank_edrpou', { length: 8 }), // ЄДРПОУ банку
  vatPayer: boolean('vat_payer').notNull().default(false),
  vatNumber: varchar('vat_number', { length: 12 }),
  taxNote: text('tax_note'), // e.g. «Платник єдиного податку 3 групи»
  signatory: text('signatory'), // e.g. «Директор Іваненко І. І.»
  phone: varchar('phone', { length: 32 }),
  email: varchar('email', { length: 255 }),
  updatedAt: stamp('updated_at').notNull(),
});

// Invoices (рахунки) for a batch, in UAH. `amount` is without VAT; VAT at `vatRate`, fixed when the
// invoice is issued, comes on top.
export const invoices = mysqlTable(
  'invoices',
  {
    id: id(),
    number: varchar('number', { length: 24 }).notNull(), // «070926-1»: issue date DDMMYY, then the day's sequence
    orderId: ref('order_id').notNull(),
    clientId: ref('client_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull(), // prepayment | balance | full
    description: text('description'), // the line on the printed invoice; derived from the batch when empty
    amount: money('amount').notNull(), // without VAT
    vatRate: int('vat_rate').notNull(), // 0 or 20 (%)
    issuedAt: stamp('issued_at').notNull(),
    dueAt: stamp('due_at'),
    status: varchar('status', { length: 16 }).notNull(), // issued | paid | cancelled
    paidAmount: money('paid_amount'), // received, VAT included
    paidAt: stamp('paid_at'),
    note: text('note'), // encrypted
    createdBy: ref('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('invoices_number').on(t.number), index('invoices_order_id').on(t.orderId), index('invoices_status').on(t.status)]
);

// What is bought for a batch: PCBs, components, the stencil, contractor work.
export const purchases = mysqlTable(
  'purchases',
  {
    id: id(),
    orderId: ref('order_id').notNull(),
    category: varchar('category', { length: 16 }).notNull(), // pcb | components | stencil | service | other
    supplier: varchar('supplier', { length: 64 }).notNull(), // JLCPCB, LCSC, PCBWay, a contractor, ...
    description: text('description'), // encrypted
    supplierOrderNo: varchar('supplier_order_no', { length: 64 }),
    trackingNumber: varchar('tracking_number', { length: 64 }),
    cost: money('cost'),
    currency: varchar('currency', { length: 3 }),
    status: varchar('status', { length: 16 }).notNull(), // planned | ordered | shipped | received | cancelled
    orderedAt: stamp('ordered_at'),
    expectedAt: stamp('expected_at'),
    receivedAt: stamp('received_at'),
    ...timestamps(),
  },
  (t) => [index('purchases_order_id').on(t.orderId), index('purchases_status').on(t.status)]
);

// The prep checklist of a batch before assembly: one row per item (pnp_program, stencil,
// thermal_profile) once someone has touched it; a missing row means «pending».
export const orderPrep = mysqlTable(
  'order_prep',
  {
    orderId: ref('order_id').notNull(),
    item: varchar('item', { length: 24 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(), // pending | done | not_needed
    documentId: ref('document_id'), // the program / profile file, also among the batch's files
    note: text('note'), // encrypted
    updatedBy: ref('updated_by').notNull(),
    updatedAt: stamp('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.item] })]
);

// Delivery notes (видаткові накладні): what was shipped to a client, possibly from several of its
// batches at once. Prices are copied from the batches when the note is made, VAT on top.
export const shipments = mysqlTable(
  'shipments',
  {
    id: id(),
    number: varchar('number', { length: 24 }).notNull(), // «070926-1»: the note's date DDMMYY, then the day's sequence
    clientId: ref('client_id').notNull(),
    shippedAt: stamp('shipped_at').notNull(),
    vatRate: int('vat_rate').notNull(),
    carrier: varchar('carrier', { length: 64 }), // e.g. «Нова пошта»
    trackingNumber: varchar('tracking_number', { length: 64 }), // ТТН
    note: text('note'), // encrypted
    createdBy: ref('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('shipments_number').on(t.number), index('shipments_client_id').on(t.clientId)]
);

export const shipmentLines = mysqlTable(
  'shipment_lines',
  {
    shipmentId: ref('shipment_id').notNull(),
    position: int('position').notNull(),
    orderId: ref('order_id').notNull(),
    description: text('description').notNull(),
    quantity: int('quantity').notNull(),
    unitPrice: money('unit_price').notNull(), // UAH without VAT, as agreed for the batch
  },
  (t) => [primaryKey({ columns: [t.shipmentId, t.position] }), index('shipment_lines_order_id').on(t.orderId)]
);

// Leave requests (відпустки, лікарняні): filed by anyone, approved or rejected by an owner.
export const leaveRequests = mysqlTable(
  'leave_requests',
  {
    id: id(),
    userId: ref('user_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull(), // vacation | sick | unpaid | other
    startDate: stamp('start_date').notNull(), // UTC midnight, inclusive
    endDate: stamp('end_date').notNull(), // UTC midnight, inclusive
    reason: text('reason'), // encrypted
    status: varchar('status', { length: 16 }).notNull(), // pending | approved | rejected | cancelled
    decidedBy: ref('decided_by'),
    decidedAt: stamp('decided_at'),
    decisionNote: text('decision_note'), // encrypted
    ...timestamps(),
  },
  (t) => [index('leave_requests_user_id').on(t.userId), index('leave_requests_status').on(t.status)]
);
