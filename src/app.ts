import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import routes from './routes';
import notFound from './middleware/notFound';
import errorHandler from './middleware/errorHandler';
import { verifyOrigin } from './middleware/verifyOrigin';

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(verifyOrigin(CLIENT_ORIGIN));

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;
