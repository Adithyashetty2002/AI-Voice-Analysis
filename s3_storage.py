import boto3
from botocore.exceptions import NoCredentialsError, ClientError
import logging
from config import MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET, MINIO_REGION

logger = logging.getLogger(__name__)

class S3Client:
    def __init__(self):
        try:
            self.s3 = boto3.client(
                's3',
                endpoint_url=MINIO_ENDPOINT,
                aws_access_key_id=MINIO_ACCESS_KEY,
                aws_secret_access_key=MINIO_SECRET_KEY,
                region_name=MINIO_REGION
            )
            self.bucket_name = MINIO_BUCKET
            
            # Optionally check if bucket exists, or create it
            # self._ensure_bucket_exists()
        except Exception as e:
            logger.error(f"Failed to initialize S3Client: {e}")
            self.s3 = None

    def _ensure_bucket_exists(self):
        try:
            self.s3.head_bucket(Bucket=self.bucket_name)
        except ClientError:
            logger.info(f"Bucket {self.bucket_name} not found. Creating it...")
            try:
                self.s3.create_bucket(Bucket=self.bucket_name)
            except Exception as e:
                logger.error(f"Failed to create bucket: {e}")

    def upload_file(self, file_path: str, object_name: str) -> bool:
        """Upload a file to an S3 bucket"""
        if not self.s3:
            logger.error("S3 client not initialized. Cannot upload.")
            return False
            
        try:
            self.s3.upload_file(file_path, self.bucket_name, object_name)
            logger.info(f"Successfully uploaded {file_path} to {self.bucket_name}/{object_name}")
            return True
        except FileNotFoundError:
            logger.error(f"The file was not found: {file_path}")
            return False
        except NoCredentialsError:
            logger.error("Credentials not available")
            return False
        except Exception as e:
            logger.error(f"Failed to upload {file_path} to S3: {e}")
            return False

    def download_file(self, object_name: str, file_path: str) -> bool:
        """Download a file from an S3 bucket"""
        if not self.s3:
            logger.error("S3 client not initialized. Cannot download.")
            return False
            
        try:
            self.s3.download_file(self.bucket_name, object_name, file_path)
            logger.info(f"Successfully downloaded {self.bucket_name}/{object_name} to {file_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to download {object_name} from S3: {e}")
            return False

    def get_presigned_url(self, object_name: str, expiration=3600) -> str:
        """Generate a presigned URL to share an S3 object"""
        if not self.s3:
            return None
        try:
            response = self.s3.generate_presigned_url('get_object',
                                                      Params={'Bucket': self.bucket_name,
                                                              'Key': object_name},
                                                      ExpiresIn=expiration)
            return response
        except Exception as e:
            logger.error(f"Error generating presigned URL for {object_name}: {e}")
            return None

    def delete_file(self, object_name: str) -> bool:
        if not self.s3:
            return False
        try:
            self.s3.delete_object(Bucket=self.bucket_name, Key=object_name)
            return True
        except Exception as e:
            logger.error(f"Failed to delete {object_name}: {e}")
            return False

s3_client = S3Client()
