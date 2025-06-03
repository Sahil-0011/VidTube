import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Configure cloudinary with validation
if (!process.env.CLOUDINARY_CLOUD_NAME || 
    !process.env.CLOUDINARY_API_KEY || 
    !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary configuration missing in environment variables');
}

cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true // Always use HTTPS
});

/**
 * Uploads a file to Cloudinary
 * @param {string} localFilePath - Absolute path to the file
 * @returns {Promise<Object>} Cloudinary upload response
 */
const uploadOnCloudinary = async (localFilePath) => {
    try {
        if (!localFilePath) {
            throw new Error('No file path provided');
        }

        // Verify file exists
        if (!fs.existsSync(localFilePath)) {
            throw new Error(`File not found at path: ${localFilePath}`);
        }

        console.log(`Uploading file: ${localFilePath}`);
        
        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto", // lowercase 'auto' is more standard
            use_filename: true,
            unique_filename: false,
            overwrite: true
        });

        console.log('File uploaded to Cloudinary:', {
            url: response.secure_url,
            public_id: response.public_id,
            bytes: response.bytes
        });

        // Clean up local file
        fs.unlinkSync(localFilePath);
        console.log(`Local file deleted: ${localFilePath}`);

        return response;

    } catch (error) {
        console.error('Cloudinary upload error:', error);
        
        // Attempt to clean up local file if it exists
        if (localFilePath && fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
            console.log(`Cleaned up local file after error: ${localFilePath}`);
        }
        
        throw error; // Re-throw to let calling code handle it
    }
};

/**
 * Deletes a file from Cloudinary
 * @param {string} publicId - The public_id of the file to delete
 * @returns {Promise<Object>} Cloudinary deletion result
 */
const deleteFromCloudinary = async (publicId) => {
    try {
        if (!publicId) {
            throw new Error('No publicId provided');
        }

        console.log(`Deleting from Cloudinary: ${publicId}`);
        const result = await cloudinary.uploader.destroy(publicId);
        
        if (result.result !== 'ok') {
            throw new Error(`Deletion failed for ${publicId}: ${result.result}`);
        }

        console.log('Successfully deleted from Cloudinary:', publicId);
        return result;

    } catch (error) {
        console.error('Cloudinary deletion error:', error);
        throw error; // Re-throw to let calling code handle it
    }
};

export { uploadOnCloudinary, deleteFromCloudinary };