import { Request, Response } from 'express';
import { Company, COMPANY_FIELDS, companyJson, getCompany, saveCompany } from '../models/company.model';

export async function get(req: Request, res: Response): Promise<void> {
  res.json(companyJson(await getCompany()));
}

export async function update(req: Request, res: Response): Promise<void> {
  const company = await getCompany();
  const body = req.body as Record<string, unknown>;
  for (const key of COMPANY_FIELDS) {
    if (body[key] !== undefined) (company as unknown as Record<string, unknown>)[key] = body[key] === null ? undefined : body[key];
  }
  await saveCompany(company as Company);
  res.json(companyJson(company));
}
