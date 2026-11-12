import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { tabTo } from "./keyboard";

const BASE = "http://localhost:3100";
// Loopback http is allowed, and this one is Ferry's own 404: the test only
// needs the address the browser lands on.
const CALLBACK = `${BASE}/connect-test-callback`;

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

async function registerApp(
  request: APIRequestContext,
  redirectUri = CALLBACK,
): Promise<string> {
  const res = await request.post("/api/oauth/register", {
    data: {
      client_name: "Claude",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    },
  });
  expect(res.status(), "registration").toBe(201);
  return (await res.json()).client_id as string;
}

/** With no scope, an app asks for all Ferry has, as a client may. */
function authorizePath(
  clientId: string,
  challenge: string,
  redirectUri = CALLBACK,
  scope?: string,
): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "e2e-state",
    resource: `${BASE}/mcp`,
    ...(scope === undefined ? {} : { scope }),
  });
  return `/oauth/authorize?${query}`;
}

/** Signs in as the seeded account and lands on `path`, as Buffer sign-in would. */
async function signInTo(page: Page, path: string): Promise<void> {
  await page.goto(`/api/dev/login?next=${encodeURIComponent(path)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Connect Claude to Ferry",
  );
}

test("asks a signed-out visitor to sign in with Buffer and come back", async ({
  page,
}) => {
  const clientId = await registerApp(page.request);
  const path = authorizePath(clientId, pkce().challenge);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Connect Claude to Ferry",
  );
  const signIn = page
    .getByRole("main")
    .getByRole("link", { name: "Sign in with Buffer" });
  const href = (await signIn.getAttribute("href")) ?? "";
  const next = new URL(href, BASE).searchParams.get("next") ?? "";
  expect(new URL(href, BASE).pathname).toBe("/api/auth/buffer");
  expect(new URL(next, BASE).searchParams.get("client_id")).toBe(clientId);
});

test("connects an app on Allow, and the app can read Ferry", async ({
  page,
}) => {
  const { verifier, challenge } = pkce();
  const clientId = await registerApp(page.request);
  await signInTo(page, authorizePath(clientId, challenge));
  await expect(page.getByText("an app on this computer")).toBeVisible();
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL(/\/connect-test-callback\?/);

  const back = new URL(page.url()).searchParams;
  expect(back.get("state")).toBe("e2e-state");
  expect(back.get("iss")).toBe(BASE);
  const token = await page.request.post("/api/oauth/token", {
    form: {
      grant_type: "authorization_code",
      client_id: clientId,
      code: back.get("code") ?? "",
      code_verifier: verifier,
      redirect_uri: CALLBACK,
    },
  });
  expect(token.status()).toBe(200);
  const { access_token } = await token.json();

  const call = await page.request.post("/mcp", {
    headers: {
      authorization: `Bearer ${access_token}`,
      accept: "application/json, text/event-stream",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_overview", arguments: {} },
    },
  });
  expect(call.status()).toBe(200);
  expect((await call.json()).result.structuredContent.account.name).toBe(
    "Ferry Dev",
  );
});

test("an app allowed to make changes can pause a route, and Settings says so", async ({
  page,
}) => {
  const { verifier, challenge } = pkce();
  const clientId = await registerApp(page.request);
  await signInTo(page, authorizePath(clientId, challenge));
  await page
    .getByRole("checkbox", { name: "Also let Claude make changes" })
    .check();
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL(/\/connect-test-callback\?/);
  const token = await page.request.post("/api/oauth/token", {
    form: {
      grant_type: "authorization_code",
      client_id: clientId,
      code: new URL(page.url()).searchParams.get("code") ?? "",
      code_verifier: verifier,
      redirect_uri: CALLBACK,
    },
  });
  const { access_token, scope } = await token.json();
  expect(scope).toBe("ferry:read ferry:write");

  const mcp = async (message: Record<string, unknown>) =>
    (
      await page.request.post("/mcp", {
        headers: {
          authorization: `Bearer ${access_token}`,
          accept: "application/json, text/event-stream",
        },
        data: { jsonrpc: "2.0", id: 1, ...message },
      })
    ).json();
  const listed = await mcp({ method: "tools/list" });
  expect(listed.result.tools.map((t: { name: string }) => t.name)).toContain(
    "pause_route",
  );
  const paused = await mcp({
    method: "tools/call",
    params: {
      name: "pause_route",
      arguments: { routeId: "dev-telegram-route" },
    },
  });
  expect(paused.result.structuredContent.route.state).toBe("paused");

  // The owner sees the change, and what the app may do.
  await page.goto("/app");
  await expect(
    page
      .getByRole("region", { name: "Routes" })
      .getByRole("listitem")
      .filter({ hasText: "Ferry Updates" })
      .getByText("Paused", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Settings" })
      .getByRole("list", { name: "Connected apps" })
      .getByRole("listitem")
      .first(),
  ).toContainText("localhost · can make changes · connected");
});

test("sends Cancel back to the app as access_denied", async ({ page }) => {
  const clientId = await registerApp(page.request);
  await signInTo(page, authorizePath(clientId, pkce().challenge));
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForURL(/\/connect-test-callback\?/);
  const back = new URL(page.url()).searchParams;
  expect(back.get("error")).toBe("access_denied");
  expect(back.has("code")).toBe(false);
});

test("names the site an app returns to, and cautions about unknown ones", async ({
  page,
}) => {
  const claude = "https://claude.ai/api/mcp/auth_callback";
  const clientId = await registerApp(page.request, claude);
  await signInTo(page, authorizePath(clientId, pkce().challenge, claude));
  const main = page.getByRole("main");
  await expect(main.getByText("claude.ai", { exact: true })).toBeVisible();
  await expect(main.getByText(/doesn't know/)).toHaveCount(0);

  // An app may call itself Claude; only its site says where it lives.
  const lookalike = "https://claude-connector.example/cb";
  const fakeId = await registerApp(page.request, lookalike);
  await page.goto(authorizePath(fakeId, pkce().challenge, lookalike));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Connect Claude to Ferry",
  );
  await expect(
    main.getByText(/Ferry doesn't know claude-connector\.example/),
  ).toBeVisible();
});

test("offers changes unticked, and only to an app that asks for them", async ({
  page,
}) => {
  const clientId = await registerApp(page.request);
  await signInTo(page, authorizePath(clientId, pkce().challenge));
  const main = page.getByRole("main");
  const box = main.getByRole("checkbox", {
    name: "Also let Claude make changes",
  });
  await expect(box).not.toBeChecked();
  await expect(box).toHaveAccessibleDescription(
    /pause and resume routes.*couldn't delete anything/,
  );
  await expect(main.getByText(/and asks to make changes too/)).toBeVisible();
  await expect(
    main.getByText(
      "Change routes or destinations, or post anywhere, unless you allow it below",
    ),
  ).toBeVisible();

  await page.goto(
    authorizePath(clientId, pkce().challenge, CALLBACK, "ferry:read"),
  );
  await expect(main.getByRole("checkbox")).toHaveCount(0);
  await expect(main.getByText(/asks to make changes/)).toHaveCount(0);
  await expect(
    main.getByText("Change routes or destinations, or post anywhere", {
      exact: true,
    }),
  ).toBeVisible();
});

test("keeps a known app's bad request on Ferry instead of sending it on", async ({
  page,
}) => {
  const evil = "https://evil.example/landing";
  const clientId = await registerApp(page.request, evil);
  // Signed out, with nothing clicked: Ferry must not bounce the visitor.
  await page.goto(
    `/oauth/authorize?${new URLSearchParams({ client_id: clientId, response_type: "token" })}`,
  );
  expect(new URL(page.url()).origin).toBe(BASE);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This link doesn't work",
  );
});

test("explains a link Ferry can't use instead of following it", async ({
  page,
}) => {
  await page.goto(
    `/oauth/authorize?client_id=c1.made.up&redirect_uri=${encodeURIComponent("https://evil.example/cb")}`,
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This link doesn't work",
  );
  expect(new URL(page.url()).origin).toBe(BASE);
});

test("can't be framed by another site", async ({ request }) => {
  const clientId = await registerApp(request);
  const res = await request.get(authorizePath(clientId, pkce().challenge));
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["content-security-policy"]).toBe(
    "frame-ancestors 'none'",
  );
  // no-referrer would send the form's Origin as "null", which the
  // decision endpoint refuses.
  expect(res.headers()["referrer-policy"]).toBe("same-origin");
  // Nor any other page: the dashboard's buttons count too.
  for (const path of ["/", "/app", "/privacy"]) {
    const page = await request.get(path);
    expect(page.headers()["x-frame-options"], path).toBe("DENY");
    expect(page.headers()["content-security-policy"], path).toBe(
      "frame-ancestors 'none'",
    );
  }
});

test("the consent screen passes axe in light and dark, and takes the keyboard", async ({
  page,
}) => {
  const clientId = await registerApp(page.request);
  const path = authorizePath(clientId, pkce().challenge);
  // The same screen for a site Ferry doesn't know, with its caution.
  const unknown = "https://connector.example/cb";
  const cautioned = authorizePath(
    await registerApp(page.request, unknown),
    pkce().challenge,
    unknown,
  );
  await signInTo(page, path);
  for (const target of [path, cautioned])
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(target);
      // One screen ticked, so axe sees the box both ways.
      if (target === cautioned) await page.getByRole("checkbox").check();
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(
        violations.map((v) => ({
          rule: v.id,
          targets: v.nodes.map((n) => n.target.join(" ")),
        })),
        `axe violations in ${colorScheme}${target === cautioned ? " with the caution" : ""}`,
      ).toEqual([]);
    }
  await page.goto(path);
  const box = page.getByRole("checkbox", {
    name: "Also let Claude make changes",
  });
  await tabTo(page, box);
  await page.keyboard.press("Space");
  await expect(box).toBeChecked();
  await tabTo(page, page.getByRole("button", { name: "Allow" }));
  await tabTo(page, page.getByRole("button", { name: "Cancel" }));
});

test("lists a connected app in Settings, and Disconnect ends its access", async ({
  page,
}) => {
  const { verifier, challenge } = pkce();
  const clientId = await registerApp(page.request);
  await signInTo(page, authorizePath(clientId, challenge));
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL(/\/connect-test-callback\?/);
  const token = await page.request.post("/api/oauth/token", {
    form: {
      grant_type: "authorization_code",
      client_id: clientId,
      code: new URL(page.url()).searchParams.get("code") ?? "",
      code_verifier: verifier,
      redirect_uri: CALLBACK,
    },
  });
  const { access_token } = await token.json();

  // Disconnect runs a server action, so wait for hydration: the first poll.
  const polled = page.waitForResponse((r) => r.url().endsWith("/api/live"));
  await page.goto("/app");
  await polled;
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(
    settings.getByRole("textbox", { name: "Connector address" }),
  ).toHaveValue(`${BASE}/mcp`);
  // Buffer's own server, to write and schedule posts in the same chat.
  await expect(
    settings.getByRole("textbox", { name: "Buffer's MCP server" }),
  ).toHaveValue("https://mcp.buffer.com/mcp");
  const apps = settings.getByRole("list", { name: "Connected apps" });
  const count = await apps.getByRole("listitem").count();
  // Newest first, so the app just connected heads the list.
  const newest = apps.getByRole("listitem").first();
  await expect(newest).toContainText("localhost · reads only · connected");
  await newest.getByRole("button", { name: "Disconnect Claude" }).click();
  await expect(settings.locator("[data-section-status]")).toHaveText(
    "Claude is disconnected.",
  );
  await expect(
    settings.getByRole("heading", { name: "Settings" }),
  ).toBeFocused();
  if (count > 1)
    await expect(apps.getByRole("listitem")).toHaveCount(count - 1);

  const ping = await page.request.post("/mcp", {
    headers: { authorization: `Bearer ${access_token}` },
    data: { jsonrpc: "2.0", id: 1, method: "ping" },
  });
  expect(ping.status()).toBe(401);
});
