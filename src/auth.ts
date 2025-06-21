/**
 * A Google Oauth middleware
 */

import {randomUUID} from 'crypto'
import url from 'url';

const {google} = require('googleapis');
import { Request, Response, NextFunction } from 'express';

export interface AuthOptions {
  google_client_id: string,
  google_client_secret: string,
  /** http(s)://{base_url}/auth/redirect (assuming /auth/:path) */
  google_redirect_url: string,

  setState?: (state: string, req: Request) => Promise<void> | void,
  checkState?: (state: string, req: Request) => Promise<boolean> | boolean,

  loginHandler?: (email: string, req: Request, res: Response) => Promise<void> | void,
  logoutHandler?: (req: Request, res: Response) => Promise<void> | void,
  errorHandler?: (error: string, req: Request, res: Response) => Promise<void> | void,
}

declare module 'express-session' {
  interface SessionData {
    auth?: {
      state?: string,
      email?: string,
    };
  }
}


class AuthHandlers {
  constructor(private options: AuthOptions) {}

  route(req: Request, res: Response, next: NextFunction) {
  }

  getOauth2Client() {
    return new google.auth.OAuth2({
      client_id: this.options.google_client_id,
      client_secret: this.options.google_client_secret,
      redirectUri: this.options.google_redirect_url,
    });
  }

  async setState(state: string, req: Request) {
    await (this.options.setState ?? (() => {
      req.session.auth = {state};
    }))(state, req);
  }

  async checkState(state: string, req: Request) {
    return await (this.options.checkState ?? (() => {
      return state === req.session.auth?.state;
    }))(state, req);
  }

  async errorHandler(error: string, req: Request, res: Response) {
    await (this.options.errorHandler ?? (() => {
      console.error(`Auth Error: ${error}`);
      res.status(500);
      res.end('Server Error');
    }))(error, req, res);
  }

  async loginHandler(req: Request, res: Response) {
    const state = randomUUID();
    await this.setState(state, req);

    const client = this.getOauth2Client();
    const authorizationUrl = client.generateAuthUrl({
      include_granted_scopes: true,
      scope: 'https://www.googleapis.com/auth/userinfo.email',
      state: state,
      redirect_uri: process.env.OAUTH_CLIENT_REDIRECT
    });
    res.redirect(authorizationUrl);
  }

  async logoutHandler (req: Request, res: Response) {
    await (this.options.logoutHandler ?? (() => {
      req.session.auth = {};
      res.redirect('/');
    }))(req, res);
  }

  async redirectHandler(req: Request, res: Response) {
    let q = url.parse(req.url, true).query;

    if (q.error) {
      await this.errorHandler('Google Returned Error:' + q.error, req, res);
      return;
    }
    if (!await this.checkState(q.state as string, req)) { //check state value
      await this.errorHandler(`State mismatch.`, req, res);
      return;
    }
    
    // Get access and refresh tokens (if access_type is offline)
    const client = this.getOauth2Client();
    let { tokens } = await client.getToken(q.code as string);
    client.setCredentials(tokens);
    const ticket = await client.verifyIdToken({
      idToken: tokens?.id_token as string,
      audience: this.options.google_client_id,
    });
    const payload = ticket.getPayload();
    if (payload === undefined) {
      await this.errorHandler('Missing payload.', req, res)
      return;
    }
    const email = payload['email']
    if (email === undefined) {
      await this.errorHandler('Payload missing email.', req, res)
      return;
    }
    if (this.options.loginHandler) {
      await this.options.loginHandler(email, req, res);
    } else {
      req.session.auth = {email};
      res.redirect('/');
    }
  }
}

/** 
 * AuthMiddleware creator. apply with: 
 * app.get('/auth/:path', AuthMiddleware({...}))
 */
export function AuthMiddleware(options: AuthOptions) {
  const handler = new AuthHandlers(options);
  const routes: Record<string, (req: Request, res: Response) => void> = {
    login: (req, res) => handler.loginHandler(req, res),
    logout: (req, res) => handler.logoutHandler(req, res),
    redirect: (req, res) => handler.redirectHandler(req, res),
  }
  return (req: Request, res: Response, next: NextFunction) => {
    const routeHandler = routes[req.params.path];
    if (routeHandler) routeHandler(req, res);
    req.emit('finish');
  }
}
