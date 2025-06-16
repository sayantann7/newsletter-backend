import { S3 } from "aws-sdk";
import fs from "fs";
require("dotenv").config();

const s3 = new S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: "ap-south-1"
});

export const uploadFile = async (key: string, fileBuffer: Buffer) => {
  await s3
    .upload({
      Bucket: "tensorboy",
      Key: key,
      Body: fileBuffer,
      ACL: "public-read",
      ContentType: "application/octet-stream",
    })
    .promise();
};