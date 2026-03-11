import { S3Client, ListObjectsV2Command, HeadObjectCommand } from 'npm:@aws-sdk/client-s3@3.750.0';
const client = new S3Client({
  region: Deno.env.get('BEGET_S3_REGION') || 'ru1',
  endpoint: Deno.env.get('BEGET_S3_ENDPOINT') || 'https://s3.ru1.storage.beget.cloud',
  forcePathStyle: true,
  credentials: {
    accessKeyId: Deno.env.get('BEGET_S3_ACCESS_KEY_ID') || '',
    secretAccessKey: Deno.env.get('BEGET_S3_SECRET_ACCESS_KEY') || '',
  },
});
const Bucket = Deno.env.get('BEGET_S3_BUCKET') || '';
const Prefix = 'profiles/';
const list = await client.send(new ListObjectsV2Command({ Bucket, Prefix, MaxKeys: 20 }));
console.log(JSON.stringify({ bucket: Bucket, keyCount: list.KeyCount, contents: (list.Contents || []).map((x) => x.Key) }, null, 2));
const head = await client.send(new HeadObjectCommand({ Bucket, Key: 'profiles/8b29d952-70fa-476b-baa5-140e1ae669e9/profile_1773156687958_e3fa17835c96200c.jpg' }));
console.log(JSON.stringify({ headOk: true, contentType: head.ContentType, contentLength: head.ContentLength }, null, 2));
