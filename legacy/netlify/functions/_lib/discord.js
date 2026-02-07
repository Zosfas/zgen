function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

function discordAuthorizeUrl() {
  const clientId = required("DISCORD_CLIENT_ID");
  const callback = required("DISCORD_CALLBACK_URL");
  const scope = encodeURIComponent("identify guilds");
  const redirectUri = encodeURIComponent(callback);
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scope}`;
}

async function exchangeCode(code) {
  const params = new URLSearchParams({
    client_id: required("DISCORD_CLIENT_ID"),
    client_secret: required("DISCORD_CLIENT_SECRET"),
    grant_type: "authorization_code",
    code,
    redirect_uri: required("DISCORD_CALLBACK_URL"),
  });

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!response.ok) {
    throw new Error("Discord token exchange failed");
  }

  return response.json();
}

async function fetchDiscord(path, accessToken) {
  const response = await fetch(`https://discord.com/api${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Discord API failed: ${path}`);
  }

  return response.json();
}

export function hasDiscordConfig() {
  return !!(
    process.env.DISCORD_CLIENT_ID &&
    process.env.DISCORD_CLIENT_SECRET &&
    process.env.DISCORD_CALLBACK_URL
  );
}

export function buildDiscordLoginUrl() {
  return discordAuthorizeUrl();
}

export async function resolveDiscordUserFromCode(code) {
  const token = await exchangeCode(code);
  const profile = await fetchDiscord("/users/@me", token.access_token);
  const allowedGuild = process.env.DISCORD_ALLOWED_GUILD;

  if (allowedGuild) {
    const guilds = await fetchDiscord("/users/@me/guilds", token.access_token);
    const inAllowed = Array.isArray(guilds)
      ? guilds.some((guild) => guild.id === allowedGuild)
      : false;
    if (!inAllowed) {
      throw new Error("User is not in allowed guild");
    }
  }

  return {
    id: profile.id,
    username: profile.username,
    discriminator: profile.discriminator || "0000",
    avatar: profile.avatar || null,
  };
}
