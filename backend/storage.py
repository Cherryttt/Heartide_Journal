import uuid
import os
import shutil
import json
import boto3
from fastapi import HTTPException, UploadFile
from config import settings

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024


def storage_configured() -> bool:
    return bool(settings.s3_endpoint_url and settings.s3_access_key and settings.s3_secret_key)


def upload_file(file: UploadFile, user_id: str) -> str:
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "仅支持 JPG、PNG、WebP 或 GIF 图片")
    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "图片不能超过 8MB")
    extension = ALLOWED_IMAGE_TYPES[file.content_type]
    if not storage_configured():
        upload_dir = os.path.join(os.path.dirname(__file__), "data", "uploads", user_id)
        os.makedirs(upload_dir, exist_ok=True)
        filename = f"{uuid.uuid4()}.{extension}"
        with open(os.path.join(upload_dir, filename), "wb") as output:
            shutil.copyfileobj(file.file, output)
        return f"/uploads/{user_id}/{filename}"
    key = f"users/{user_id}/{uuid.uuid4()}.{extension}"
    client = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
    )
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except Exception:
        client.create_bucket(Bucket=settings.s3_bucket)
    if settings.s3_public_url:
        client.put_bucket_policy(
            Bucket=settings.s3_bucket,
            Policy=json.dumps({
                "Version": "2012-10-17",
                "Statement": [{
                    "Effect": "Allow",
                    "Principal": "*",
                    "Action": ["s3:GetObject"],
                    "Resource": [f"arn:aws:s3:::{settings.s3_bucket}/*"],
                }],
            }),
        )
    client.upload_fileobj(file.file, settings.s3_bucket, key, ExtraArgs={"ContentType": file.content_type or "application/octet-stream"})
    return f"{settings.s3_public_url.rstrip('/')}/{key}" if settings.s3_public_url else client.generate_presigned_url("get_object", Params={"Bucket": settings.s3_bucket, "Key": key}, ExpiresIn=86400)


def delete_user_assets(user_id: str):
    if not storage_configured():
        uploads_root = os.path.realpath(os.path.join(os.path.dirname(__file__), "data", "uploads"))
        user_directory = os.path.realpath(os.path.join(uploads_root, user_id))
        if os.path.commonpath([uploads_root, user_directory]) == uploads_root:
            shutil.rmtree(user_directory, ignore_errors=True)
        return

    client = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
    )
    continuation_token = None
    prefix = f"users/{user_id}/"
    while True:
        request = {"Bucket": settings.s3_bucket, "Prefix": prefix}
        if continuation_token:
            request["ContinuationToken"] = continuation_token
        result = client.list_objects_v2(**request)
        objects = [{"Key": item["Key"]} for item in result.get("Contents", [])]
        if objects:
            client.delete_objects(Bucket=settings.s3_bucket, Delete={"Objects": objects, "Quiet": True})
        if not result.get("IsTruncated"):
            break
        continuation_token = result.get("NextContinuationToken")
