export const CHANNEL_FIELDS = `fragment ChannelFields on Channel {
  id organizationId service name displayName avatar isDisconnected isQueuePaused isLocked
}`;

export const POST_FIELDS = `fragment PostFields on Post {
  id status text dueAt sentAt channelId channelService contentItemId externalLink
  tags { id name }
  error { message supportUrl }
  assets { type source thumbnail mimeType ... on ImageAsset { image { altText } } }
  metadata {
    ... on TwitterPostMetadata { thread { text assets { type source thumbnail mimeType ... on ImageAsset { image { altText } } } } }
    ... on BlueskyPostMetadata {
      thread { text assets { type source thumbnail mimeType ... on ImageAsset { image { altText } } } }
      linkAttachment { url title text thumbnail }
    }
    ... on ThreadsPostMetadata {
      thread { text assets { type source thumbnail mimeType ... on ImageAsset { image { altText } } } }
      linkAttachment { url title text thumbnail }
    }
    ... on MastodonPostMetadata { thread { text assets { type source thumbnail mimeType ... on ImageAsset { image { altText } } } } }
    ... on LinkedInPostMetadata { linkAttachment { url title text thumbnail } }
    ... on FacebookPostMetadata { linkAttachment { url title text thumbnail } }
  }
}`;

export const ACCOUNT_QUERY = `query Account {
  account { id name timezone organizations { id name } }
}`;

export const CHANNELS_QUERY = `query Channels($org: OrganizationId!) {
  channels(input: { organizationId: $org }) { ...ChannelFields }
}
${CHANNEL_FIELDS}`;

export const LATEST_SENT_QUERY = `query LatestSent($org: OrganizationId!, $ch: ChannelId!) {
  posts(
    first: 1
    input: {
      organizationId: $org
      filter: { channelIds: [$ch], status: [sent] }
      sort: [{ field: dueAt, direction: desc }]
    }
  ) {
    edges { node { ...PostFields } }
  }
}
${POST_FIELDS}`;

/** One query for every organization: recent (r), upcoming (u) and channels (c) per org. */
export function buildSyncQuery(orgCount: number): string {
  const vars: string[] = ["$since: DateTime!", "$until: DateTime!"];
  const selections: string[] = [];
  for (let i = 0; i < orgCount; i++) {
    vars.push(`$o${i}: OrganizationId!`, `$ch${i}: [ChannelId!]`);
    selections.push(`  r${i}: posts(
    first: 100
    input: {
      organizationId: $o${i}
      filter: { channelIds: $ch${i}, status: [sent, error], dueAt: { start: $since } }
      sort: [{ field: dueAt, direction: desc }]
    }
  ) {
    edges { node { ...PostFields } }
  }
  u${i}: posts(
    first: 100
    input: {
      organizationId: $o${i}
      filter: { channelIds: $ch${i}, status: [scheduled, sending], dueAt: { end: $until } }
      sort: [{ field: dueAt, direction: asc }]
    }
  ) {
    edges { node { id channelId dueAt status } }
  }
  c${i}: channels(input: { organizationId: $o${i} }) { ...ChannelFields }`);
  }
  return `query Sync(${vars.join(", ")}) {
${selections.join("\n")}
}
${POST_FIELDS}
${CHANNEL_FIELDS}`;
}

export function syncVariables(args: {
  orgs: { organizationId: string; channelIds: string[] }[];
  since: number;
  until: number;
}): Record<string, unknown> {
  const vars: Record<string, unknown> = {
    since: new Date(args.since).toISOString(),
    until: new Date(args.until).toISOString(),
  };
  args.orgs.forEach((org, i) => {
    vars[`o${i}`] = org.organizationId;
    vars[`ch${i}`] = org.channelIds;
  });
  return vars;
}
