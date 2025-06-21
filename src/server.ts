
import path from 'node:path';

import express from 'express';
import session from 'express-session';
import * as sqlite3 from 'sqlite3';
import sqliteStoreFactory from 'express-session-sqlite'

import {Data, User, listFormatters} from './data';
import {AuthMiddleware} from './auth';

declare module 'express-session' {
  interface SessionData {
    user?: User,
  }
}

declare module "express-serve-static-core" {
  interface Request {
    time?: Date;
  }
}

const dataDir = process.env.DATA ?? path.join(__dirname, '../');

const common = {
  emums: {
    periods: [
      ["h", "Hours"],
      ["d", "Days"],
      ["w", "Weeks"],
      ["m", "Months"],
      ["y", "Years"],
    ],
    data
  }
}

export function runServer() {
  const port = Number(process.env.PORT ?? '8888');
  const data = new Data();

  const app = express();

  app.use(express.static('static'));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));

  // set up logging
  app.use((req, res, next) => {
    const start = new Date();
    const path = req.path;
    res.on('finish', () => {
      console.log(`${
        start.toISOString().split('T')[1].split('Z')[0]
      } [${res.statusCode}] ${path} (${
        (new Date().getTime() - start.getTime())
      }ms)`);
    })
    next();
  })

  // set up sessions
  const SqliteStore = sqliteStoreFactory(session);
  app.use(session({
    secret: process.env.SECRET as string,
    resave: false,
    saveUninitialized: false,
    store: new SqliteStore({
      driver: sqlite3.Database,
      path: path.join(dataDir, 'sessions.sqlite3'),
      ttl: 365 * 24 * 3600 * 1000,
    }),
  }));

  // set up auth
  app.use('/auth/:path', AuthMiddleware({
    google_client_id: process.env.OAUTH_CLIENT_ID!,
    google_client_secret: process.env.OAUTH_CLIENT_SECRET!,
    google_redirect_url: `${process.env.ROOT_URL}/auth/redirect`,

    logoutHandler: (req, res) => {
      req.session.user = undefined;
      res.redirect('/');
    },

    loginHandler: async (email, req, res) => {
      const user = await data.getOrCreateUser(email);
      req.session.user = user;
      res.redirect('/');
    },
  }));

  app.get('/', (req, res) => {
    res.render('index',
    {
      user: req.session.user,
      timers: [],
      groups: [],
    });
  });

  app.listen(port, async () => {
    await data.init();
    console.log(`Listening on port ${port}`);
  });
}