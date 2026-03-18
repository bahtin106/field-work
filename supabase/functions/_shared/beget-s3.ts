import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from 'npm:@aws-sdk/client-s3@3.750.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.750.0';

const DEFAULT_ENDPOINT = 'https://s3.ru1.storage.beget.cloud';
const DEFAULT_REGION = 'ru1';

let cachedClient: S3Client | null = null;

function getRequiredEnv(name: string) {
  const value = String(Deno.env.get(name) || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function encodeKeyPath(key: string) {
  return String(key || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function getBegetS3Config() {
  const endpoint = String(Deno.env.get('BEGET_S3_ENDPOINT') || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '');
  const region = String(Deno.env.get('BEGET_S3_REGION') || DEFAULT_REGION).trim() || DEFAULT_REGION;
  const bucket = getRequiredEnv('BEGET_S3_BUCKET');
  const accessKeyId = getRequiredEnv('BEGET_S3_ACCESS_KEY_ID');
  const secretAccessKey = getRequiredEnv('BEGET_S3_SECRET_ACCESS_KEY');
  const publicBaseUrl = String(Deno.env.get('BEGET_S3_PUBLIC_BASE_URL') || '').trim().replace(/\/+$/, '');

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
  };
}

export function getBegetS3Client() {
  if (cachedClient) return cachedClient;
  const cfg = getBegetS3Config();
  cachedClient = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return cachedClient;
}

export function buildBegetPublicUrl(key: string) {
  const cfg = getBegetS3Config();
  const safeKey = encodeKeyPath(String(key || '').replace(/^\/+/, ''));
  if (!safeKey) throw new Error('Missing object key');

  if (cfg.publicBaseUrl) {
    return `${cfg.publicBaseUrl}/${safeKey}`;
  }

  const host = new URL(cfg.endpoint).host;
  return `https://${cfg.bucket}.${host}/${safeKey}`;
}

export async function putBegetObject(args: {
  key: string;
  body: Uint8Array;
  contentType?: string;
  cacheControl?: string;
}) {
  const cfg = getBegetS3Config();
  const client = getBegetS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: String(args.key || '').replace(/^\/+/, ''),
      Body: args.body,
      ContentType: args.contentType || 'application/octet-stream',
      CacheControl: args.cacheControl || 'public, max-age=31536000, immutable',
    }),
  );
}

export async function createBegetPresignedPutUrl(args: {
  key: string;
  contentType?: string;
  expiresInSec?: number;
  cacheControl?: string;
}) {
  const cfg = getBegetS3Config();
  const client = getBegetS3Client();
  const key = String(args.key || '').replace(/^\/+/, '');
  if (!key) throw new Error('Missing object key');

  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: args.contentType || 'application/octet-stream',
    CacheControl: args.cacheControl || 'public, max-age=31536000, immutable',
  });

  const url = await getSignedUrl(client, command, {
    expiresIn: Math.max(60, Number(args.expiresInSec || 900)),
  });

  return {
    url,
    method: 'PUT',
    headers: {
      'Content-Type': args.contentType || 'application/octet-stream',
      'Cache-Control': args.cacheControl || 'public, max-age=31536000, immutable',
    },
  };
}

export async function headBegetObject(key: string) {
  const cfg = getBegetS3Config();
  const client = getBegetS3Client();
  const safeKey = String(key || '').replace(/^\/+/, '').trim();
  if (!safeKey) throw new Error('Missing object key');
  return client.send(
    new HeadObjectCommand({
      Bucket: cfg.bucket,
      Key: safeKey,
    }),
  );
}

export async function deleteBegetObject(key: string) {
  const cfg = getBegetS3Config();
  const client = getBegetS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: cfg.bucket,
      Key: String(key || '').replace(/^\/+/, ''),
    }),
  );
}

export async function listBegetKeys(prefix: string) {
  const cfg = getBegetS3Config();
  const client = getBegetS3Client();
  const safePrefix = String(prefix || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!safePrefix) return [] as string[];

  const keys: string[] = [];
  let continuationToken: string | undefined;

  while (true) {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: safePrefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of result.Contents || []) {
      const key = String(item.Key || '').trim();
      if (key) keys.push(key);
    }

    if (!result.IsTruncated || !result.NextContinuationToken) break;
    continuationToken = result.NextContinuationToken;
  }

  return keys;
}

export async function listBegetObjectsWithSize(prefix: string) {
  const cfg = getBegetS3Config();
  const client = getBegetS3Client();
  const safePrefix = String(prefix || '').replace(/^\/+/, '').replace(/\/+$/, '');
  const result = new Map<string, number>();
  if (!safePrefix) return result;

  let continuationToken: string | undefined;

  while (true) {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: safePrefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of resp.Contents || []) {
      const key = String(item.Key || '').trim();
      if (key) result.set(key, Number(item.Size || 0));
    }

    if (!resp.IsTruncated || !resp.NextContinuationToken) break;
    continuationToken = resp.NextContinuationToken;
  }

  return result;
}

export async function deleteBegetKeys(keys: string[]) {
  const cfg = getBegetS3Config();
  const client = getBegetS3Client();
  const safeKeys = Array.isArray(keys)
    ? keys.map((key) => String(key || '').replace(/^\/+/, '').trim()).filter(Boolean)
    : [];
  if (!safeKeys.length) return;

  for (let i = 0; i < safeKeys.length; i += 1000) {
    const batch = safeKeys.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: cfg.bucket,
        Delete: {
          Objects: batch.map((key) => ({ Key: key })),
          Quiet: true,
        },
      }),
    );
  }
}
