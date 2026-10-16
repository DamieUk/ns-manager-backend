import { eq } from 'drizzle-orm';
import { db } from '../db';
import { company } from '../db/schema';
import { castString } from '../utils/validate';
import { HttpError } from '../utils/HttpError';
import { normalizeRequisites, Requisites } from '../utils/requisites';

export interface Company extends Requisites {
  name: string;
  bankMfo?: string;
  bankEdrpou?: string;
  vatPayer: boolean;
  taxNote?: string;
  phone?: string;
  email?: string;
  updatedAt: Date;
}

export const COMPANY_FIELDS = [
  'name',
  'legalName',
  'edrpou',
  'legalAddress',
  'iban',
  'bankName',
  'bankMfo',
  'bankEdrpou',
  'vatPayer',
  'vatNumber',
  'taxNote',
  'signatory',
  'phone',
  'email',
] as const;

const ROW_ID = 'main';
const VAT_RATE = 20;

// The VAT rate a new invoice gets: 20% for a VAT payer, otherwise none.
export const vatRateOf = (c: Company) => (c.vatPayer ? VAT_RATE : 0);

export async function getCompany(): Promise<Company> {
  const [row] = await db().select().from(company).where(eq(company.id, ROW_ID));
  if (!row) return { name: 'Numenor Systems', vatPayer: false, updatedAt: new Date(0) };
  return {
    name: row.name,
    legalName: row.legalName ?? undefined,
    edrpou: row.edrpou ?? undefined,
    legalAddress: row.legalAddress ?? undefined,
    iban: row.iban ?? undefined,
    bankName: row.bankName ?? undefined,
    bankMfo: row.bankMfo ?? undefined,
    bankEdrpou: row.bankEdrpou ?? undefined,
    vatPayer: row.vatPayer,
    vatNumber: row.vatNumber ?? undefined,
    taxNote: row.taxNote ?? undefined,
    signatory: row.signatory ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    updatedAt: row.updatedAt,
  };
}

export async function saveCompany(c: Company): Promise<void> {
  c.name = castString(c.name)?.trim() as string;
  if (!c.name) throw new HttpError(400, 'Вкажіть назву компанії');
  normalizeRequisites(c);
  c.bankMfo = castString(c.bankMfo)?.replace(/\s+/g, '');
  c.bankEdrpou = castString(c.bankEdrpou)?.replace(/\s+/g, '');
  if (c.bankMfo && !/^\d{6}$/.test(c.bankMfo)) throw new HttpError(400, 'МФО банку має містити 6 цифр');
  if (c.bankEdrpou && !/^\d{8}$/.test(c.bankEdrpou)) throw new HttpError(400, 'ЄДРПОУ банку має містити 8 цифр');
  c.taxNote = castString(c.taxNote)?.trim();
  c.phone = castString(c.phone)?.trim();
  c.email = castString(c.email)?.trim().toLowerCase();
  c.vatPayer = c.vatPayer === true || (c.vatPayer as unknown) === 'true';
  if (c.vatPayer && !c.vatNumber) throw new HttpError(400, 'Платнику ПДВ потрібен ІПН платника ПДВ');
  c.updatedAt = new Date();

  const values = {
    name: c.name,
    legalName: c.legalName || null,
    edrpou: c.edrpou || null,
    legalAddress: c.legalAddress || null,
    iban: c.iban || null,
    bankName: c.bankName || null,
    bankMfo: c.bankMfo || null,
    bankEdrpou: c.bankEdrpou || null,
    vatPayer: c.vatPayer,
    vatNumber: c.vatNumber || null,
    taxNote: c.taxNote || null,
    signatory: c.signatory || null,
    phone: c.phone || null,
    email: c.email || null,
    updatedAt: c.updatedAt,
  };
  await db().insert(company).values({ id: ROW_ID, ...values }).onDuplicateKeyUpdate({ set: values });
}

export function companyJson(c: Company) {
  return {
    name: c.name,
    legalName: c.legalName ?? '',
    edrpou: c.edrpou ?? '',
    legalAddress: c.legalAddress ?? '',
    iban: c.iban ?? '',
    bankName: c.bankName ?? '',
    bankMfo: c.bankMfo ?? '',
    bankEdrpou: c.bankEdrpou ?? '',
    vatPayer: c.vatPayer,
    vatNumber: c.vatNumber ?? '',
    taxNote: c.taxNote ?? '',
    signatory: c.signatory ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    updatedAt: c.updatedAt,
  };
}
