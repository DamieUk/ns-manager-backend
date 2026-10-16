import { HttpError } from './HttpError';
import { castString } from './validate';

export interface Requisites {
  legalName?: string;
  edrpou?: string;
  legalAddress?: string;
  iban?: string;
  bankName?: string;
  vatNumber?: string;
  signatory?: string;
}

// Trims the requisites printed on invoices and delivery notes (a client's or our own) in place
// and checks the formats of the codes.
export function normalizeRequisites(r: Requisites): void {
  r.legalName = castString(r.legalName)?.trim();
  r.edrpou = castString(r.edrpou)?.replace(/\s+/g, '');
  r.legalAddress = castString(r.legalAddress)?.trim();
  r.iban = castString(r.iban)?.replace(/\s+/g, '').toUpperCase();
  r.bankName = castString(r.bankName)?.trim();
  r.vatNumber = castString(r.vatNumber)?.replace(/\s+/g, '');
  r.signatory = castString(r.signatory)?.trim();
  if (r.edrpou && !/^(\d{8}|\d{10})$/.test(r.edrpou)) throw new HttpError(400, 'ЄДРПОУ має містити 8 цифр (або ІПН ФОП — 10 цифр)');
  if (r.iban && !/^UA\d{27}$/.test(r.iban)) throw new HttpError(400, 'IBAN має бути у форматі UA + 27 цифр');
  if (r.vatNumber && !/^\d{10,12}$/.test(r.vatNumber)) throw new HttpError(400, 'ІПН платника ПДВ має містити 10–12 цифр');
}
