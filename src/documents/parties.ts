import { Client } from '../models/client.model';
import { Company } from '../models/company.model';
import { HttpError } from '../utils/HttpError';
import { Party } from './pdfLayout';

// Requisites as printed on our invoices and delivery notes.

export function supplierParty(c: Company): Party {
  return {
    title: 'Постачальник:',
    lines: [
      c.legalName ?? c.name,
      c.iban && `IBAN ${c.iban}`,
      c.edrpou && `ЄДРПОУ ${c.edrpou}`,
      c.vatNumber && `ІПН ${c.vatNumber}`,
      c.bankName ?? '',
      c.bankMfo && `МФО ${c.bankMfo}`,
      c.bankEdrpou && `ЄДРПОУ Банку ${c.bankEdrpou}`,
      c.legalAddress ?? '',
      c.taxNote ?? '',
    ].filter((l): l is string => Boolean(l)),
  };
}

export function clientParty(c: Client, title: string): Party {
  return {
    title,
    lines: [
      c.legalName ?? c.name,
      c.iban && `IBAN ${c.iban}`,
      c.bankName && `в ${c.bankName}`,
      c.edrpou && `${c.edrpou.length === 10 ? 'ІПН' : 'ЄДРПОУ'} ${c.edrpou}`,
      c.vatNumber && `ІПН платника ПДВ ${c.vatNumber}`,
      c.legalAddress ?? '',
    ].filter((l): l is string => Boolean(l)),
  };
}

// A document is only generated with both sides' essential requisites in place.
export function assertRequisites(company: Company, client: Client): void {
  const missingCompany = [
    !company.legalName && 'юридична назва',
    !company.edrpou && 'ЄДРПОУ',
    !company.iban && 'IBAN',
    !company.bankName && 'банк',
  ].filter(Boolean);
  if (missingCompany.length) {
    throw new HttpError(409, `Заповніть реквізити компанії на сторінці «Компанія»: ${missingCompany.join(', ')}`);
  }
  const missingClient = [!client.legalName && 'повна юридична назва', !client.edrpou && 'ЄДРПОУ', !client.legalAddress && 'юридична адреса'].filter(
    Boolean
  );
  if (missingClient.length) {
    throw new HttpError(409, `Заповніть реквізити клієнта «${client.name}»: ${missingClient.join(', ')}`);
  }
}
