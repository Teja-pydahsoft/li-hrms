const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadToS3, deleteFromS3, replaceInS3, isS3Configured } = require('../services/s3UploadService');
const { protect } = require('../../authentication/middleware/authMiddleware');

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024 // 20MB limit
    },
    fileFilter: (req, file, cb) => {
        // Accept images and PDFs only
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPG, PNG, and PDF are allowed.'));
        }
    }
});

/**
 * @desc    Upload certificate file
 * @route   POST /api/upload/certificate
 * @access  Private
 */
router.post('/certificate', protect, upload.single('file'), async (req, res) => {
    try {
        // Check if S3 is configured
        if (!isS3Configured()) {
            return res.status(500).json({
                success: false,
                message: 'S3 storage is not configured. Please contact administrator.'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        console.log(`[Upload Certificate] User: ${req.user.email}, File: ${req.file.originalname}`);

        const fileUrl = await uploadToS3(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            'certificates/qualifications'
        );

        res.json({
            success: true,
            url: fileUrl,
            filename: req.file.originalname,
            size: req.file.size,
            mimeType: req.file.mimetype
        });
    } catch (error) {
        console.error('Certificate upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload certificate',
            error: error.message
        });
    }
});

/**
 * @desc    Delete certificate file
 * @route   DELETE /api/upload/certificate
 * @access  Private
 */
router.delete('/certificate', protect, async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'File URL is required'
            });
        }

        console.log(`[Delete Certificate] User: ${req.user.email}, URL: ${url}`);

        await deleteFromS3(url);

        res.json({
            success: true,
            message: 'Certificate deleted successfully'
        });
    } catch (error) {
        console.error('Certificate delete error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete certificate',
            error: error.message
        });
    }
});

/**
 * @desc    Replace certificate file (delete old, upload new)
 * @route   PUT /api/upload/certificate
 * @access  Private
 */
router.put('/certificate', protect, upload.single('file'), async (req, res) => {
    try {
        const { oldUrl } = req.body;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        console.log(`[Replace Certificate] User: ${req.user.email}, Old: ${oldUrl}, New: ${req.file.originalname}`);

        const newUrl = await replaceInS3(
            oldUrl,
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            'certificates/qualifications'
        );

        res.json({
            success: true,
            url: newUrl,
            filename: req.file.originalname,
            message: 'Certificate replaced successfully'
        });
    } catch (error) {
        console.error('Certificate replace error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to replace certificate',
            error: error.message
        });
    }
});

/**
 * @desc    Upload evidence file (OD/OT/Permission)
 * @route   POST /api/upload/evidence
 * @access  Private
 */
/**
 * @desc    Upload employee profile photo
 * @route   POST /api/upload/profile
 * @access  Private
 */
const profileUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/jpg'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPG and PNG images are allowed for profile photo.'));
        }
    }
});
router.post('/profile', protect, profileUpload.single('file'), async (req, res) => {
    try {
        if (!isS3Configured()) {
            return res.status(500).json({
                success: false,
                message: 'S3 storage is not configured.'
            });
        }
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }
        const fileUrl = await uploadToS3(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            'profiles'
        );
        res.json({
            success: true,
            url: fileUrl,
            filename: req.file.originalname
        });
    } catch (error) {
        console.error('Profile upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload profile photo',
            error: error.message
        });
    }
});

router.post('/evidence', protect, upload.single('file'), async (req, res) => {
    try {
        if (!isS3Configured()) {
            return res.status(500).json({
                success: false,
                message: 'S3 storage is not configured.'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');

        const fileUrl = await uploadToS3(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            `evidence/${year}/${month}`
        );

        res.json({
            success: true,
            url: fileUrl,
            key: `evidence/${year}/${month}`, // Returning partial key if needed
            filename: req.file.originalname
        });
    } catch (error) {
        console.error('Evidence upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload evidence',
            error: error.message
        });
    }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File size too large. Maximum size is 20MB.'
            });
        }
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    if (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    next();
});

module.exports = router;
