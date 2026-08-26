import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import passport from './config/passport';
import routes from './routes';
import notFound from './middleware/notFound';
import errorHandler from './middleware/errorHandler';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(passport.initialize());

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;
