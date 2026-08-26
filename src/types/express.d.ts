import { HydratedDocument } from 'mongoose';
import { IUser } from '../models/user.model';

declare global {
  namespace Express {
    interface User extends HydratedDocument<IUser> {}
    interface Request {
      user?: User;
    }
  }
}

export {};
