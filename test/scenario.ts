import fs from 'fs';
import { Actor, ApiResponse, Step, TestServer, day, form, sha256, sleep, upload } from './harness';

const UNKNOWN_ID = '0123456789abcdef01234567';

type Body = Record<string, any>;

// Walks the whole API as two executives (owners) and employees and records every response, so a
// rewrite of the data layer can be checked against the recorded run. Dates are relative to
// today and creates that are later listed by createdAt are spaced apart, so the run is stable.
export async function runScenario(server: TestServer, execPassword: string): Promise<Step[]> {
  const steps: Step[] = [];
  const rec = (step: string, res: ApiResponse, pick?: (res: ApiResponse) => unknown): Body => {
    steps.push({ step, status: res.status, body: pick ? pick(res) : res.data });
    return (res.data ?? {}) as Body;
  };
  const note = (step: string, body: unknown) => steps.push({ step, status: 0, body });
  // File deletes run in the background after the response, so give them a moment.
  const uploadsCount = async () => {
    await sleep(100);
    return fs.readdirSync(server.uploadDir).length;
  };
  const tick = () => sleep(15);

  let logCursor = 0;
  const takeToken = async (email: string, page: 'accept-invite' | 'reset-password'): Promise<string> => {
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`email to ${escaped} not sent .*Link: \\S+/${page}\\?token=([0-9a-f]+)`);
    for (let i = 0; i < 50; i++) {
      const fresh = server.output().slice(logCursor);
      const match = fresh.match(pattern);
      if (match) {
        logCursor += fresh.indexOf(match[0]) + match[0].length;
        return match[1];
      }
      await sleep(50);
    }
    throw new Error(`no ${page} link logged for ${email}`);
  };

  const anon = new Actor('anon');
  const exec = new Actor('exec');
  const partner = new Actor('co-owner');
  const olena = new Actor('olena');
  const petro = new Actor('petro');
  const ivan = new Actor('ivan');
  const login = (actor: Actor, email: string, password: string) =>
    actor.req('POST', '/auth/login', { json: { email, password } });

  // ---- auth
  rec('health', await anon.req('GET', '/health'), (r) => ({ status: (r.data as Body).status }));
  rec('me without session', await anon.req('GET', '/auth/me'));
  rec('login missing password', await login(anon, 'exec@test.local', undefined as unknown as string));
  rec('login wrong password', await login(exec, 'exec@test.local', 'wrong-password'));
  rec('login exec (email case-insensitive)', await login(exec, 'EXEC@test.local', execPassword), (r) => ({
    body: r.data,
    cookie: r.headers.getSetCookie().map((c) => c.replace(/numenor_session=[^;]+/, 'numenor_session=<token>').replace(/Expires=[^;]+/, 'Expires=<date>')),
  }));
  const execId = rec('me exec', await exec.req('GET', '/auth/me')).id;
  rec('bearer header is not accepted', await anon.req('GET', '/auth/me', { headers: { authorization: `Bearer ${exec.cookie?.split('=')[1]}` } }));

  // ---- users
  const person = { jobTitle: 'Assembler', phone: '+380 44 000 00 00', address: 'Kyiv' };
  rec('create user missing name', await exec.req('POST', '/users', { json: { ...person, email: 'x@test.local', role: 'employee' } }));
  rec('create user invalid role', await exec.req('POST', '/users', { json: { ...person, firstName: 'A', lastName: 'B', email: 'x@test.local', role: 'boss' } }));
  rec('create user with removed manager role', await exec.req('POST', '/users', {
    json: { ...person, firstName: 'A', lastName: 'B', email: 'x@test.local', role: 'manager' },
  }));
  const partnerId = rec('create co-owner', await exec.req('POST', '/users', {
    json: { ...person, firstName: 'Maria', lastName: 'Partner', jobTitle: 'Co-owner', email: ' Partner@Test.local ', role: 'executive' },
  })).id;
  const inviteToken = await takeToken('partner@test.local', 'accept-invite');
  rec('accept invite short password', await anon.req('POST', '/auth/accept-invite', { json: { token: inviteToken, password: 'short' } }));
  rec('accept invite', await anon.req('POST', '/auth/accept-invite', { json: { token: inviteToken, password: 'partner-pass-1' } }));
  rec('accept invite token reused', await anon.req('POST', '/auth/accept-invite', { json: { token: inviteToken, password: 'partner-pass-1' } }));
  rec('accept invite missing token', await anon.req('POST', '/auth/accept-invite', { json: { password: 'whatever-123' } }));
  await tick();
  const e1 = rec('create employee olena', await exec.req('POST', '/users', {
    json: { ...person, firstName: 'Олена', lastName: 'Шевченко', email: 'olena@test.local', role: 'employee', status: 'working' },
  })).id;
  await tick();
  const e2 = rec('create employee petro', await exec.req('POST', '/users', {
    json: { ...person, firstName: 'Petro', lastName: 'Koval', email: 'petro@test.local', role: 'employee' },
  })).id;
  rec('create user duplicate email', await exec.req('POST', '/users', {
    json: { ...person, firstName: 'Dup', lastName: 'Dup', email: 'OLENA@test.local', role: 'employee' },
  }));
  rec('set password too short', await exec.req('PUT', `/users/${e1}/password`, { json: { password: '123' } }));
  rec('set password olena', await exec.req('PUT', `/users/${e1}/password`, { json: { password: 'olena-pass-1' } }));
  rec('set password petro', await exec.req('PUT', `/users/${e2}/password`, { json: { password: 'petro-pass-1' } }));
  rec('login co-owner', await login(partner, 'partner@test.local', 'partner-pass-1'));
  rec('login olena', await login(olena, 'olena@test.local', 'olena-pass-1'));
  rec('login petro', await login(petro, 'petro@test.local', 'petro-pass-1'));
  rec('admin changes olena password', await exec.req('PUT', `/users/${e1}/password`, { json: { password: 'olena-pass-2' } }));
  rec('olena session after password change', await olena.req('GET', '/auth/me'));
  rec('login olena new password', await login(olena, 'olena@test.local', 'olena-pass-2'));

  rec('employee creates user', await olena.req('POST', '/users', {
    json: { ...person, firstName: 'No', lastName: 'Way', email: 'boss@test.local', role: 'executive' },
  }));
  await tick();
  const e3 = rec('co-owner creates employee with custom permissions', await partner.req('POST', '/users', {
    json: { ...person, firstName: 'Ivan', lastName: 'Tkach', email: 'ivan@test.local', role: 'employee', permissions: [{ key: 'PRODUCTS', action: 'none' }] },
  })).id;
  await takeToken('ivan@test.local', 'accept-invite'); // invite sent on create; not used
  rec('co-owner edits executive', await partner.req('PUT', `/users/${execId}`, { json: { jobTitle: 'Founder' } }));
  rec('employee edits executive', await olena.req('PUT', `/users/${execId}`, { json: { jobTitle: 'Nope' } }));
  rec('employee sets executive password', await olena.req('PUT', `/users/${execId}/password`, { json: { password: 'hijack-123' } }));
  rec('list users', await exec.req('GET', '/users'));
  rec('get user', await exec.req('GET', `/users/${e1}`));
  rec('get user malformed id', await exec.req('GET', '/users/not-an-id'));
  rec('get user unknown id', await exec.req('GET', `/users/${UNKNOWN_ID}`));
  rec('update user', await exec.req('PUT', `/users/${e1}`, { json: { jobTitle: 'Senior assembler', phone: '+380 67 111 11 11', status: 'vacation' } }));
  rec('update user invalid status', await exec.req('PUT', `/users/${e1}`, { json: { status: 'retired' } }));
  rec('update user empty first name', await exec.req('PUT', `/users/${e1}`, { json: { firstName: '' } }));
  rec('update user back to working', await exec.req('PUT', `/users/${e1}`, { json: { status: 'working', address: 'Lviv' } }));
  rec('co-owner lists users', await partner.req('GET', '/users'));
  rec('employee lists users', await olena.req('GET', '/users'));

  rec('forgot password unknown email', await anon.req('POST', '/auth/forgot-password', { json: { email: 'nobody@test.local' } }));
  rec('forgot password petro', await anon.req('POST', '/auth/forgot-password', { json: { email: 'Petro@test.local' } }));
  const resetToken = await takeToken('petro@test.local', 'reset-password');
  rec('reset password bad token', await anon.req('POST', '/auth/reset-password', { json: { token: 'deadbeef', password: 'petro-pass-2' } }));
  rec('reset password', await anon.req('POST', '/auth/reset-password', { json: { token: resetToken, password: 'petro-pass-2' } }));
  rec('petro session after reset', await petro.req('GET', '/auth/me'));
  rec('login petro old password', await login(petro, 'petro@test.local', 'petro-pass-1'));
  rec('login petro new password', await login(petro, 'petro@test.local', 'petro-pass-2'));
  rec('forgot password not activated (sends invite)', await anon.req('POST', '/auth/forgot-password', { json: { email: 'ivan@test.local' } }));
  const ivanToken = await takeToken('ivan@test.local', 'accept-invite');
  rec('accept invite ivan', await anon.req('POST', '/auth/accept-invite', { json: { token: ivanToken, password: 'ivan-pass-1' } }));
  rec('login ivan', await login(ivan, 'ivan@test.local', 'ivan-pass-1'));

  // ---- clients
  const pdf = (name: string) => upload(`%PDF-1.4 ${name}`, 'application/pdf', name);
  const png = (name: string) => upload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), 'image/png', name);
  rec('create client without contract', await exec.req('POST', '/clients', { form: form({ name: 'X', code: 'X-1' }) }));
  rec('create client contract not pdf', await exec.req('POST', '/clients', { form: form({ name: 'X', code: 'X-1' }, { contract: [png('c.png')] }) }));
  rec('create client missing code', await exec.req('POST', '/clients', { form: form({ name: 'X' }, { contract: [pdf('c.pdf')] }) }));
  const c1 = rec('create client borysfen', await exec.req('POST', '/clients', {
    form: form(
      { name: '  Борисфен Електронікс ', code: ' bor-01 ', contactName: ' Андрій ', email: ' Info@Borysfen.UA ', phone: '+380 44 222', address: 'Київ', notes: 'VIP клієнт', contractTitle: 'Рамковий договір' },
      { contract: [pdf('contract-borysfen.pdf')], documents: [pdf('spec-a.pdf'), png('drawing.png')] }
    ),
  }))._id;
  await tick();
  const c2 = rec('create client alpha', await exec.req('POST', '/clients', {
    form: form({ name: 'alpha systems', code: 'ALP-02' }, { contract: [pdf('contract-alpha.pdf')] }),
  }))._id;
  await tick();
  const c3 = rec('create client zeta', await exec.req('POST', '/clients', {
    form: form({ name: 'Zeta Labs', code: 'zet-03', email: 'hello@zeta.io' }, { contract: [pdf('contract-zeta.pdf')] }),
  }))._id;
  rec('create client duplicate code', await exec.req('POST', '/clients', {
    form: form({ name: 'Dup', code: 'BOR-01' }, { contract: [pdf('contract-dup.pdf')] }),
  }));
  note('uploads after clients', await uploadsCount());
  rec('list clients', await exec.req('GET', '/clients'));
  rec('get client', await exec.req('GET', `/clients/${c1}`));
  rec('get client malformed id', await exec.req('GET', '/clients/xyz'));
  rec('get client unknown id', await exec.req('GET', `/clients/${UNKNOWN_ID}`));
  rec('update client', await exec.req('PUT', `/clients/${c3}`, { json: { phone: '+1 555 0100', notes: '', email: ' NEW@Zeta.io', contactName: null } }));
  rec('update client invalid status', await exec.req('PUT', `/clients/${c3}`, { json: { status: 'archived' } }));
  rec('update client empty name', await exec.req('PUT', `/clients/${c3}`, { json: { name: '' } }));
  rec('employee lists clients', await olena.req('GET', '/clients'));
  rec('co-owner lists clients', await partner.req('GET', '/clients'));

  // ---- contracts
  rec('list contracts', await exec.req('GET', '/contracts'));
  rec('list contracts by client', await exec.req('GET', `/contracts?client=${c1}`));
  rec('create contract missing title', await exec.req('POST', '/contracts', { json: { client: c1 } }));
  rec('create contract unknown client', await exec.req('POST', '/contracts', { json: { title: 'X', client: UNKNOWN_ID } }));
  rec('create contract invalid status', await exec.req('POST', '/contracts', { json: { title: 'X', client: c2, status: 'signed' } }));
  await tick();
  const startInstant = '2026-03-01T13:30:15.250Z';
  const k1 = rec('create contract', await exec.req('POST', '/contracts', {
    json: { title: '  Додаткова угода  ', client: c2, startDate: day(-30), endDate: `${day(300)}T00:00:00.000Z`, status: 'draft', notes: 'Секретно' },
  }))._id;
  const timed = rec('create contract with exact start time', await exec.req('POST', '/contracts', {
    json: { title: 'Timed', client: c3, startDate: '2026-03-01T15:30:15.250+02:00' },
  }));
  note('contract start time round-trips', timed.startDate === startInstant);
  rec('get contract', await exec.req('GET', `/contracts/${k1}`));
  rec('update contract', await exec.req('PUT', `/contracts/${k1}`, { json: { status: 'active', notes: 'Оновлено', endDate: day(400), title: 'Угода №2' } }));
  rec('update contract invalid status', await exec.req('PUT', `/contracts/${k1}`, { json: { status: 'nope' } }));
  rec('update contract unknown client', await exec.req('PUT', `/contracts/${k1}`, { json: { client: UNKNOWN_ID } }));
  rec('update contract empty title', await exec.req('PUT', `/contracts/${k1}`, { json: { title: '' } }));
  rec('delete contract', await exec.req('DELETE', `/contracts/${timed._id}`));
  rec('get deleted contract', await exec.req('GET', `/contracts/${timed._id}`));

  // ---- documents
  const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const bomBytes = Buffer.from('designator,part\nR1,10k\nC1,100n\n');
  rec('upload document without file', await exec.req('POST', '/documents', { form: form({ client: c1 }) }));
  rec('upload document without client', await exec.req('POST', '/documents', { form: form({}, { file: [pdf('a.pdf')] }) }));
  rec('upload document unknown client', await exec.req('POST', '/documents', { form: form({ client: UNKNOWN_ID }, { file: [pdf('a.pdf')] }) }));
  rec('upload document unsupported type', await exec.req('POST', '/documents', { form: form({ client: c1 }, { file: [upload('hi', 'text/plain', 'a.txt')] }) }));
  await tick();
  const d1 = rec('upload document', await exec.req('POST', '/documents', { form: form({ client: c1 }, { file: [upload(bomBytes, xlsxType, 'bom-rev-a.xlsx')] }) }))._id;
  await tick();
  const d2 = rec('upload document 2', await exec.req('POST', '/documents', { form: form({ client: c1 }, { file: [upload(Buffer.from([0xff, 0xd8, 0xff, 9]), 'image/jpeg', 'фото плати.jpg')] }) }))._id;
  await tick();
  const dOther = rec('upload document for other client', await exec.req('POST', '/documents', { form: form({ client: c2 }, { file: [pdf('alpha-spec.pdf')] }) }))._id;
  rec('list documents', await exec.req('GET', '/documents'));
  rec('list documents by client', await exec.req('GET', `/documents?client=${c1}`));
  rec('get document', await exec.req('GET', `/documents/${d1}`));
  rec('download document', await exec.req('GET', `/documents/${d1}/download`), (r) => ({
    type: r.headers.get('content-type'),
    disposition: r.headers.get('content-disposition'),
    length: r.headers.get('content-length'),
    identical: sha256(r.bytes) === sha256(bomBytes),
  }));
  rec('download document with non-ascii name', await exec.req('GET', `/documents/${d2}/download`), (r) => ({
    type: r.headers.get('content-type'),
    disposition: r.headers.get('content-disposition'),
  }));
  rec('download unknown document', await exec.req('GET', `/documents/${UNKNOWN_ID}/download`));
  rec('employee lists documents', await olena.req('GET', '/documents'));

  // ---- products
  rec('create product missing fields', await exec.req('POST', '/products', { form: form({ name: 'X' }) }));
  rec('create product invalid type', await exec.req('POST', '/products', { form: form({ name: 'X', sku: 'X-1', type: 'Gadget', client: c1 }) }));
  rec('create PCB without BOM', await exec.req('POST', '/products', { form: form({ name: 'X', sku: 'X-1', type: 'PCB', client: c1 }) }));
  rec('create product unknown client', await exec.req('POST', '/products', { form: form({ name: 'X', sku: 'X-1', type: 'Other', client: UNKNOWN_ID }) }));
  const p1Res = rec('create PCB', await exec.req('POST', '/products', {
    form: form(
      { name: ' Плата керування ', sku: ' pcb-100 ', type: 'PCB', client: c1, description: '4 шари, ENIG' },
      { bomFile: [upload(bomBytes, xlsxType, 'bom-pcb-100.xlsx')], additionalFiles: [upload('PK', 'application/zip', 'gerber.zip'), pdf('assembly.pdf')] }
    ),
  }));
  const p1 = p1Res._id;
  const p1Bom = p1Res.bomFile;
  await tick();
  const p2 = rec('create component', await exec.req('POST', '/products', { form: form({ name: 'Antenna', sku: 'ant-7', type: 'Component', client: c1 }) }))._id;
  await tick();
  const p3 = rec('create product for alpha', await exec.req('POST', '/products', { form: form({ name: 'Box', sku: 'box-1', type: 'Other', client: c2 }) }))._id;
  rec('create product duplicate sku', await exec.req('POST', '/products', { form: form({ name: 'Copy', sku: 'PCB-100', type: 'Other', client: c1 }) }));
  note('uploads after products', await uploadsCount());
  rec('list products without client', await exec.req('GET', '/products'));
  rec('list products', await exec.req('GET', `/products?client=${c1}`));
  rec('get product', await exec.req('GET', `/products/${p1}`));
  rec('update product', await exec.req('PUT', `/products/${p2}`, { json: { name: 'Antenna v2', description: 'Gain 5 dBi', additionalFiles: [d2, d1] } }));
  rec('update product invalid type', await exec.req('PUT', `/products/${p2}`, { json: { type: 'Gadget' } }));
  rec('update product clear BOM', await exec.req('PUT', `/products/${p1}`, { json: { bomFile: null } }));
  rec('get product without BOM', await exec.req('GET', `/products/${p1}`));
  rec('update product restore BOM', await exec.req('PUT', `/products/${p1}`, { json: { bomFile: p1Bom } }));
  rec('update product empty sku', await exec.req('PUT', `/products/${p1}`, { json: { sku: '' } }));
  rec('employee lists products', await olena.req('GET', `/products?client=${c1}`));
  rec('employee creates product', await olena.req('POST', '/products', { form: form({ name: 'X', sku: 'X-9', type: 'Other', client: c1 }) }));
  rec('employee without PRODUCTS lists products', await ivan.req('GET', `/products?client=${c1}`));
  rec('grant PRODUCTS view', await exec.req('PUT', `/users/${e3}`, { json: { permissions: [{ key: 'PRODUCTS', action: 'view' }] } }));
  rec('employee with granted PRODUCTS lists products', await ivan.req('GET', `/products?client=${c2}`));
  rec('change role to removed manager role', await exec.req('PUT', `/users/${e3}`, { json: { role: 'manager' } }));
  rec('promote ivan to executive', await exec.req('PUT', `/users/${e3}`, { json: { role: 'executive' } }));
  rec('demote ivan to employee', await exec.req('PUT', `/users/${e3}`, { json: { role: 'employee' } }));
  rec('deactivate ivan', await exec.req('PUT', `/users/${e3}`, { json: { isActive: false } }));
  rec('ivan session after deactivation', await ivan.req('GET', '/auth/me'));
  rec('reactivate ivan', await exec.req('PUT', `/users/${e3}`, { json: { isActive: true } }));
  rec('login ivan again', await login(ivan, 'ivan@test.local', 'ivan-pass-1'));

  // ---- orders
  const base = { client: c1, product: p1, quantity: 100, description: 'Партія 1' };
  rec('create order missing client', await exec.req('POST', '/orders', { json: { ...base, client: undefined } }));
  rec('create order missing product', await exec.req('POST', '/orders', { json: { ...base, product: undefined } }));
  rec('create order zero quantity', await exec.req('POST', '/orders', { json: { ...base, quantity: 0 } }));
  rec('create order blank description', await exec.req('POST', '/orders', { json: { ...base, description: '   ' } }));
  rec('create order unknown product', await exec.req('POST', '/orders', { json: { ...base, product: UNKNOWN_ID } }));
  rec('create order invalid status', await exec.req('POST', '/orders', { json: { ...base, status: 'paused' } }));
  rec('create order responsible is employee', await exec.req('POST', '/orders', { json: { ...base, manager: e1 } }));
  rec('create order unknown responsible', await exec.req('POST', '/orders', { json: { ...base, manager: UNKNOWN_ID } }));
  rec('create order invalid employees', await exec.req('POST', '/orders', { json: { ...base, assignedEmployees: [e1, partnerId] } }));
  rec('create order foreign documents', await exec.req('POST', '/orders', { json: { ...base, documents: [dOther] } }));
  const o1 = rec('create order', await exec.req('POST', '/orders', {
    json: { ...base, dueDate: day(10), manager: partnerId, assignedEmployees: [e2, e1], documents: [d1, d2], status: 'active' },
  }))._id;
  await tick();
  const o2 = rec('create order 2', await exec.req('POST', '/orders', { json: { client: c1, product: p2, quantity: 5, description: 'Антени', assignedEmployees: [e1] } }))._id;
  await tick();
  const o3 = rec('create order 3 overdue', await exec.req('POST', '/orders', {
    json: { client: c2, product: p3, quantity: 20, description: 'Коробки', dueDate: day(-3), manager: execId, assignedEmployees: [e2] },
  }))._id;
  await tick();
  const o4 = rec('create order 4 completed', await exec.req('POST', '/orders', {
    json: { client: c1, product: p2, quantity: 1, description: 'Готово', status: 'completed', assignedEmployees: [e1] },
  }))._id;
  rec('list orders', await exec.req('GET', '/orders'));
  rec('list orders by status', await exec.req('GET', '/orders?status=completed'));
  rec('list orders by client', await exec.req('GET', `/orders?client=${c2}`));
  rec('employee lists orders', await olena.req('GET', '/orders'));
  rec('get order', await exec.req('GET', `/orders/${o1}`));
  rec('employee gets assigned order', await olena.req('GET', `/orders/${o1}`));
  rec('employee gets unassigned order', await olena.req('GET', `/orders/${o3}`));
  rec('get order malformed id', await exec.req('GET', '/orders/123'));
  rec('employee creates order', await olena.req('POST', '/orders', { json: base }));
  rec('update order', await exec.req('PUT', `/orders/${o2}`, { json: { quantity: 8, dueDate: day(5), manager: partnerId, assignedEmployees: [e1, e3] } }));
  rec('update order clear fields', await exec.req('PUT', `/orders/${o2}`, { json: { dueDate: null, manager: null } }));
  rec('update order zero quantity', await exec.req('PUT', `/orders/${o2}`, { json: { quantity: 0 } }));
  rec('update order blank description', await exec.req('PUT', `/orders/${o2}`, { json: { description: ' ' } }));
  rec('update order invalid status', await exec.req('PUT', `/orders/${o2}`, { json: { status: 'x' } }));
  rec('update order foreign documents', await exec.req('PUT', `/orders/${o1}`, { json: { documents: [dOther] } }));
  rec('update order documents', await exec.req('PUT', `/orders/${o1}`, { json: { documents: [d2], description: 'Партія 1 (уточнено)' } }));

  // ---- daily progress
  const jpg = (name: string) => upload(Buffer.from([0xff, 0xd8, 0xff, 0xe0, name.length]), 'image/jpeg', name);
  rec('executive creates progress', await exec.req('POST', '/daily-progress', { form: form({ order: o1 }) }));
  rec('progress missing order', await olena.req('POST', '/daily-progress', { form: form({}) }));
  rec('progress unknown order', await olena.req('POST', '/daily-progress', { form: form({ order: UNKNOWN_ID }) }));
  rec('progress unassigned order', await olena.req('POST', '/daily-progress', { form: form({ order: o3 }) }));
  rec('progress inactive order', await olena.req('POST', '/daily-progress', { form: form({ order: o4 }) }));
  const dp1Res = rec('create progress', await olena.req('POST', '/daily-progress', {
    form: form({ order: o1, completed: '12', needsRework: '2', notes: 'Пайка' }, { photo: [jpg('progress-1.jpg')] }),
  }));
  const dp1 = dp1Res.id;
  rec('create progress duplicate', await olena.req('POST', '/daily-progress', { form: form({ order: o1, completed: '1' }) }));
  const dp2 = rec('create progress petro', await petro.req('POST', '/daily-progress', { form: form({ order: o1, completed: '7' }) })).id;
  const dp3 = rec('create progress order 2', await olena.req('POST', '/daily-progress', { form: form({ order: o2, completed: '3', needsRework: '0' }) })).id;
  note('uploads after first photo', await uploadsCount());
  rec('update progress', await olena.req('PUT', `/daily-progress/${dp1}`, {
    form: form({ date: day(-1), completed: '15', partiallyAssembled: '4', notes: 'Пайка + перевірка' }, { photo: [jpg('progress-2.jpg')] }),
  }));
  note('uploads after photo replaced', await uploadsCount());
  rec('update progress date', await olena.req('PUT', `/daily-progress/${dp3}`, { json: { date: day(-2) } }));
  rec('update progress negative', await olena.req('PUT', `/daily-progress/${dp3}`, { json: { completed: '-1' } }));
  rec('update progress not a number', await olena.req('PUT', `/daily-progress/${dp3}`, { json: { needsRework: 'abc' } }));
  rec('update progress of other employee', await petro.req('PUT', `/daily-progress/${dp1}`, { json: { completed: '1' } }));
  rec('executive updates progress', await exec.req('PUT', `/daily-progress/${dp1}`, { json: { completed: '1' } }));
  rec('list progress', await exec.req('GET', '/daily-progress'));
  rec('list progress by employee', await exec.req('GET', `/daily-progress?employee=${e1}`));
  rec('list progress by order', await exec.req('GET', `/daily-progress?order=${o2}`));
  rec('list progress by range', await exec.req('GET', `/daily-progress?from=${day(-1)}&to=${day(-1)}`));
  rec('list progress invalid date', await exec.req('GET', '/daily-progress?from=garbage'));
  rec('employee lists progress (filter ignored)', await petro.req('GET', `/daily-progress?employee=${e1}`));
  rec('get progress', await olena.req('GET', `/daily-progress/${dp1}`));
  rec('get progress of other employee', await petro.req('GET', `/daily-progress/${dp1}`));
  const photoId = rec('co-owner gets progress', await partner.req('GET', `/daily-progress/${dp1}`)).photo?._id;
  rec('employee downloads own photo', await olena.req('GET', `/documents/${photoId}/download`), (r) => ({ type: r.headers.get('content-type') }));
  rec('other employee downloads photo', await petro.req('GET', `/documents/${photoId}/download`));
  rec('dashboard', await exec.req('GET', '/dashboard'));
  rec('dashboard by employee', await exec.req('GET', `/dashboard?employee=${e1}`));
  rec('employee dashboard', await olena.req('GET', '/dashboard'));
  rec('my orders olena', await olena.req('GET', '/orders/mine'));
  rec('my orders petro', await petro.req('GET', '/orders/mine'));
  const dp4 = rec('create progress again today', await olena.req('POST', '/daily-progress', { form: form({ order: o1, completed: '2' }) })).id;
  rec('update progress date conflict', await olena.req('PUT', `/daily-progress/${dp4}`, { json: { date: day(-1) } }));
  rec('delete progress of other employee', await petro.req('DELETE', `/daily-progress/${dp1}`));
  rec('delete progress', await olena.req('DELETE', `/daily-progress/${dp4}`));
  rec('get deleted progress', await olena.req('GET', `/daily-progress/${dp4}`));
  rec('petro progress still there', await petro.req('GET', `/daily-progress/${dp2}`));

  // ---- deletions and links to deleted records
  rec('employee deletes order', await olena.req('DELETE', `/orders/${o4}`));
  rec('delete order', await exec.req('DELETE', `/orders/${o4}`));
  rec('get deleted order', await exec.req('GET', `/orders/${o4}`));
  rec('my orders after order delete', await olena.req('GET', '/orders/mine'));
  rec('delete document linked from order and product', await exec.req('DELETE', `/documents/${d2}`));
  rec('order after document delete', await exec.req('GET', `/orders/${o1}`));
  rec('product after document delete', await exec.req('GET', `/products/${p2}`));
  note('uploads after document delete', await uploadsCount());
  rec('delete product', await exec.req('DELETE', `/products/${p3}`));
  rec('orders after product delete', await exec.req('GET', '/orders'));
  rec('order with deleted product', await exec.req('GET', `/orders/${o3}`));
  rec('delete own account', await exec.req('DELETE', `/users/${execId}`));
  rec('delete active user', await exec.req('DELETE', `/users/${e2}`));
  rec('employee deletes executive', await olena.req('DELETE', `/users/${execId}`));
  rec('mark petro deleted', await exec.req('PUT', `/users/${e2}`, { json: { status: 'deleted' } }));
  rec('petro session after deactivation', await petro.req('GET', '/auth/me'));
  rec('login deactivated petro', await login(petro, 'petro@test.local', 'petro-pass-2'));
  rec('purge petro', await exec.req('DELETE', `/users/${e2}`));
  rec('order after user purge', await exec.req('GET', `/orders/${o1}`));
  rec('progress after user purge', await exec.req('GET', '/daily-progress'));
  rec('dashboard after user purge', await exec.req('GET', '/dashboard'));
  rec('purge active client', await exec.req('DELETE', `/clients/${c1}`));
  rec('mark client deleted', await exec.req('PUT', `/clients/${c1}`, { json: { status: 'deleted' } }));
  rec('clients include soft-deleted', await exec.req('GET', '/clients'));
  rec('purge client', await exec.req('DELETE', `/clients/${c1}`));
  note('uploads after client purge', await uploadsCount());
  rec('get purged client', await exec.req('GET', `/clients/${c1}`));
  rec('contracts after client purge', await exec.req('GET', '/contracts'));
  rec('documents after client purge', await exec.req('GET', '/documents'));
  rec('orders after client purge', await exec.req('GET', '/orders'));
  rec('progress after client purge', await exec.req('GET', '/daily-progress'));
  rec('employee progress after client purge', await olena.req('GET', '/daily-progress'));
  rec('get progress of purged order', await olena.req('GET', `/daily-progress/${dp1}`));
  rec('update progress of purged order', await olena.req('PUT', `/daily-progress/${dp1}`, { json: { completed: '1' } }));
  rec('delete progress of purged order', await olena.req('DELETE', `/daily-progress/${dp3}`));
  rec('dashboard after client purge', await exec.req('GET', '/dashboard'));
  rec('my orders after client purge', await olena.req('GET', '/orders/mine'));

  // ---- request guards and sessions
  rec('write from foreign origin', await exec.req('PUT', `/clients/${c2}`, { json: { notes: 'evil' }, origin: 'https://evil.example' }));
  rec('write without origin header', await exec.req('PUT', `/clients/${c2}`, { json: { notes: 'from a script' }, origin: null }));
  rec('unknown route', await exec.req('GET', '/nope'));
  rec('logout', await exec.req('POST', '/auth/logout'));
  rec('me after logout', await exec.req('GET', '/auth/me'));
  rec('logout without session', await exec.req('POST', '/auth/logout'));
  const statuses: number[] = [];
  for (let i = 0; i < 10; i++) statuses.push((await login(anon, 'exec@test.local', `wrong-${i}`)).status);
  note('failed logins until rate limited', statuses);
  rec('rate limited response', await login(anon, 'exec@test.local', execPassword));

  return steps;
}
