import { resolve } from "node:path";
import {
  AuthFailure,
  TWITCH_SCOPES,
  form,
  oauthRequest,
  requiredText,
  seconds,
  sleep,
} from "./auth-protocol.js";
import {
  discardTokens,
  readTokens,
  writeTokens,
  type StoredTokens,
} from "./token-store.js";
export { TWITCH_SCOPES } from "./auth-protocol.js";

export interface AuthStatus {
  phase: "idle" | "authorizing" | "ready" | "error";
  verificationUri?: string;
  userCode?: string;
  expiresAt?: number;
  userId?: string;
  login?: string;
  message?: string;
}
export interface TwitchAuthOptions {
  clientId: string;
  broadcasterLogin: string;
  tokenPath?: string;
  fetch?: typeof fetch;
  onStatus?: (status: AuthStatus) => void;
  log?: (line: string) => void;
}

/** Tokens stay in this server-side owner; getStatus returns only public fields. */
export class TwitchAuth {
  private readonly options: TwitchAuthOptions;
  private readonly fetcher: typeof fetch;
  private readonly path: string;
  private controller = new AbortController();
  private status: AuthStatus = { phase: "idle" };
  private tokens?: StoredTokens;
  private starting?: Promise<void>;
  private refreshing?: Promise<string>;
  private maintenance?: ReturnType<typeof setTimeout>;
  private lastValidatedAt = 0;

  constructor(options: TwitchAuthOptions) {
    this.options = options;
    this.fetcher = options.fetch ?? fetch;
    this.path = options.tokenPath ?? resolve(".tokens.json");
  }
  getStatus(): AuthStatus {
    return { ...this.status };
  }
  private publish(status: AuthStatus) {
    this.status = status;
    this.options.onStatus?.(this.getStatus());
  }
  start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.status.phase === "ready") return Promise.resolve();
    this.controller = new AbortController();
    this.starting = this.initialize()
      .catch(async (error) => {
        await this.fail(error);
        throw error;
      })
      .finally(() => {
        this.starting = undefined;
      });
    return this.starting;
  }
  stop(): void {
    this.controller.abort(new Error("Twitch authentication stopped."));
    clearTimeout(this.maintenance);
    this.tokens = undefined;
    this.publish({ phase: "idle" });
  }
  private async fail(error: unknown) {
    clearTimeout(this.maintenance);
    if (this.controller.signal.aborted) return;
    if (
      error instanceof AuthFailure &&
      ["invalid", "denied"].includes(error.kind)
    ) {
      this.tokens = undefined;
      await discardTokens(this.path).catch(() => undefined);
      if (this.controller.signal.aborted) return;
    }
    this.publish({
      phase: "error",
      message:
        error instanceof AuthFailure
          ? error.message
          : "Twitch authentication could not be completed. Retry authorization.",
    });
  }
  private request(endpoint: string, init?: RequestInit) {
    return oauthRequest(this.fetcher, endpoint, this.controller.signal, init);
  }
  private async initialize() {
    if (!this.options.clientId.trim() || !this.options.broadcasterLogin.trim())
      throw new AuthFailure(
        "denied",
        "Set TWITCH_CLIENT_ID and TWITCH_BROADCASTER_LOGIN first.",
      );
    this.tokens = await readTokens(this.path);
    this.controller.signal.throwIfAborted();
    if (this.tokens?.clientId !== this.options.clientId)
      this.tokens = undefined;
    if (this.tokens) {
      try {
        await this.validate();
        return;
      } catch (error) {
        if (!(error instanceof AuthFailure) || error.kind !== "invalid")
          throw error;
        try {
          await this.refresh();
          return;
        } catch (refreshError) {
          if (
            !(refreshError instanceof AuthFailure) ||
            refreshError.kind !== "invalid"
          )
            throw refreshError;
          this.tokens = undefined;
        }
      }
    }
    await this.authorizeDevice();
  }
  private async authorizeDevice() {
    const data = await this.request(
      "device",
      form({
        client_id: this.options.clientId,
        scopes: TWITCH_SCOPES.join(" "),
      }),
    );
    const deviceCode = requiredText(data.device_code);
    const userCode = requiredText(data.user_code);
    const verificationUri = requiredText(data.verification_uri);
    const uri = new URL(verificationUri);
    if (
      uri.protocol !== "https:" ||
      !["www.twitch.tv", "twitch.tv", "id.twitch.tv"].includes(uri.hostname)
    )
      throw new AuthFailure(
        "denied",
        "Twitch returned an untrusted verification URL.",
      );
    const expiresAt = Date.now() + seconds(data.expires_in) * 1000;
    let interval = seconds(data.interval ?? 5) * 1000;
    this.publish({
      phase: "authorizing",
      verificationUri,
      userCode,
      expiresAt,
    });
    this.options.log?.(
      `[twitch] authorize ${verificationUri} code=${userCode}`,
    );
    while (Date.now() < expiresAt) {
      await sleep(
        Math.min(interval, expiresAt - Date.now()),
        this.controller.signal,
      );
      if (Date.now() >= expiresAt) break;
      let token: Record<string, unknown>;
      try {
        token = await this.request(
          "token",
          form({
            client_id: this.options.clientId,
            scopes: TWITCH_SCOPES.join(" "),
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        );
      } catch (error) {
        if (!(error instanceof AuthFailure)) throw error;
        if (error.kind === "slow") interval += 5000;
        else if (!["pending", "transient"].includes(error.kind)) throw error;
        continue;
      }
      await this.acceptTokens(token);
      await this.validate();
      return;
    }
    throw new AuthFailure(
      "expired",
      "Twitch device code expired. Start authorization again.",
    );
  }
  private async acceptTokens(data: Record<string, unknown>) {
    const scopes = data.scope;
    if (
      !Array.isArray(scopes) ||
      scopes.some((scope) => typeof scope !== "string")
    )
      throw new AuthFailure(
        "denied",
        "Twitch did not return the requested scopes.",
      );
    const tokens = {
      clientId: this.options.clientId,
      accessToken: requiredText(data.access_token),
      refreshToken: requiredText(data.refresh_token),
      expiresAt: Date.now() + seconds(data.expires_in) * 1000,
      scopes: scopes as string[],
    };
    this.controller.signal.throwIfAborted();
    await writeTokens(this.path, tokens);
    this.controller.signal.throwIfAborted();
    this.tokens = tokens;
  }
  private async validate() {
    if (!this.tokens)
      throw new AuthFailure("invalid", "Authorize Twitch first.");
    const data = await this.request("validate", {
      headers: { Authorization: `OAuth ${this.tokens.accessToken}` },
    });
    const userId = requiredText(data.user_id);
    const login = requiredText(data.login);
    if (data.client_id !== this.options.clientId)
      throw new AuthFailure(
        "denied",
        "Twitch token belongs to a different application.",
      );
    if (login.toLowerCase() !== this.options.broadcasterLogin.toLowerCase())
      throw new AuthFailure(
        "denied",
        "Sign in as the configured broadcaster to authorize Twitch.",
      );
    const scopes = data.scopes;
    if (
      !Array.isArray(scopes) ||
      TWITCH_SCOPES.some((scope) => !scopes.includes(scope))
    )
      throw new AuthFailure(
        "denied",
        "Twitch authorization is missing required scopes. Authorize again.",
      );
    this.tokens = {
      ...this.tokens,
      expiresAt: Date.now() + seconds(data.expires_in) * 1000,
    };
    this.lastValidatedAt = Date.now();
    this.publish({ phase: "ready", userId, login });
    this.schedule();
  }
  getAccessToken(forceRefresh = false): Promise<string> {
    if (this.refreshing) return this.refreshing;
    if (
      this.status.phase !== "ready" ||
      !this.tokens ||
      this.controller.signal.aborted
    )
      return Promise.reject(
        new AuthFailure("invalid", "Authorize Twitch first."),
      );
    return forceRefresh || this.tokens.expiresAt <= Date.now() + 60_000
      ? this.refresh().catch(async (error) => {
          await this.fail(error);
          throw error;
        })
      : Promise.resolve(this.tokens.accessToken);
  }
  private refresh(): Promise<string> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.performRefresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  private async performRefresh(): Promise<string> {
    if (!this.tokens)
      throw new AuthFailure("invalid", "Authorize Twitch first.");
    const data = await this.request(
      "token",
      form({
        client_id: this.options.clientId,
        grant_type: "refresh_token",
        refresh_token: this.tokens.refreshToken,
      }),
    );
    await this.acceptTokens(data);
    await this.validate();
    return this.tokens!.accessToken;
  }
  private schedule() {
    clearTimeout(this.maintenance);
    if (!this.tokens || this.controller.signal.aborted) return;
    const delay = Math.max(
      1000,
      Math.min(
        this.tokens.expiresAt - Date.now() - 60_000,
        this.lastValidatedAt + 3_600_000 - Date.now(),
      ),
    );
    this.maintenance = setTimeout(() => {
      const task =
        this.tokens && this.tokens.expiresAt <= Date.now() + 60_000
          ? this.refresh()
          : this.validate().catch((error) => {
              if (error instanceof AuthFailure && error.kind === "invalid")
                return this.refresh().then(() => undefined);
              throw error;
            });
      void task.catch((error) => this.fail(error));
    }, delay);
    this.maintenance.unref();
  }
}
