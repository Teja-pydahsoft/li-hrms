const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const admsParser = require('../utils/admsParser');
const AttendanceLog = require('../models/AttendanceLog');
const AdmsRawLog = require('../models/AdmsRawLog');
const Device = require('../models/Device');
const DeviceCommand = require('../models/DeviceCommand');
const DeviceUser = require('../models/DeviceUser');

/**
 * Common ADMS Responses
 */
const ADMS_OK = "OK";
const ADMS_ERROR = "ERROR";

/**
 * Middleware to ensure all ADMS protocol responses use text/plain
 * Newer eSSL/ZK devices strictly require Content-Type: text/plain
 */
router.use((req, res, next) => {
    // Blanket apply text/plain to ALL ADMS endpoints (solves the missing .aspx check)
    // Removed Cache-Control because vintage devices (iClock) have tiny buffer sizes 
    // for HTTP Headers and large headers cause them to instantly abort the connection.
    res.type('text/plain');
    next();
});

/**
 * GET /iclock/registry
 * Modern Push Protocol 3.0+ Handshake (used by AiFace series)
 */
router.get(['/registry', '/registry.aspx'], async (req, res) => {
    const { SN, RegistryCode } = req.query;
    logger.info(`ADMS Registry Handshake: SN=${SN || 'unknown'} from ${req.ip}`);
    
    // The device expects its registry code echoed back, or simply OK
    res.send(`RegistryCode=${RegistryCode || '1'}`);
});

/**
 * OPTIONS /iclock/getrequest.aspx
 * Part of some ADMS handshake flows
 */
router.options('*', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Custom-Header');
    res.sendStatus(200);
});

/**
 * GET /iclock/getrequest
 * Heartbeat, Options exchange, and Command polling
 */
router.get(['/getrequest', '/getrequest.aspx'], async (req, res) => {
    const { SN, INFO, option } = req.query;
    const clientIp = getClientIp(req);

    // Ensure device is in DB
    await ensureDeviceRegistered(SN, clientIp);
    await touchDeviceHeartbeat(SN);

    // Log basic heartbeat
    logger.info(`ADMS Heartbeat: SN=${SN}, INFO=${INFO || 'none'}, Options=${option || 'none'} from ${clientIp}`);

    try {
        // Store raw hit
        await AdmsRawLog.create({
            serialNumber: SN || 'UNKNOWN',
            table: 'HEARTBEAT',
            query: req.query,
            method: 'GET',
            ipAddress: clientIp
        });

        // Handshake: If device asks for options
        if (option === 'any') {
            const config = [
                'GET_PROTOCOL=1',
                'RegistryCode=1',
                'TransInterval=1',
                'LogInterval=1',
                'TransFlag=1111111111',
                'Realtime=1',
                'Encrypt=0',
                'TimeZone=330',
                'DaylightSavingTime=0'
            ].join('\n');
            return res.send(config);
        }

        // Command Polling: Check for PENDING commands for this device
        const pendingCmd = await DeviceCommand.findOne({
            deviceId: SN,
            status: 'PENDING'
        }).sort({ queuedAt: 1 });

        if (pendingCmd) {
            // Command format: C:ID:COMMAND_STRING
            // ID should be numeric/unique for the session
            const cmdString = `C:${pendingCmd._id.toString().slice(-6)}:${pendingCmd.command}`;

            logger.info(`ADMS Command Delivered: [${SN}] -> ${cmdString}`);

            pendingCmd.status = 'SENT';
            pendingCmd.sentAt = new Date();
            await pendingCmd.save();

            return res.send(cmdString);
        }

        // Standard heartbeat response
        res.send(ADMS_OK);

    } catch (error) {
        logger.error(`ADMS GET Error [${SN}]:`, error);
        res.status(500).send(ADMS_ERROR);
    }
});

/**
 * GET /iclock/cdata
 * ICLOCK990 uses this for handshake/options
 */
router.get(['/cdata', '/cdata.aspx'], async (req, res) => {
    const { SN, options, language, pushver } = req.query;
    const clientIp = getClientIp(req);

    // Ensure device is in DB
    await ensureDeviceRegistered(SN, clientIp);
    await touchDeviceHeartbeat(SN);

    logger.info(`ICLOCK990 Handshake: SN=${SN}, Options=${options || 'none'}, PushVer=${pushver || 'unknown'} from ${clientIp}`);

    try {
        // Store handshake attempt
        await AdmsRawLog.create({
            serialNumber: SN || 'UNKNOWN',
            table: 'HANDSHAKE',
            query: req.query,
            body: '', // GET requests have no body
            method: 'GET',
            ipAddress: clientIp
        });

        // If device asks for options (ICLOCK990 specific handshake)
        if (options === 'all') {
            // Update device with handshake metadata
            await Device.findOneAndUpdate(
                { deviceId: SN },
                {
                    $set: {
                        'protocol.pushVersion': pushver,
                        'protocol.language': language,
                        lastSeenAt: new Date()
                    }
                },
                { upsert: true }
            );

            console.log('\n');
            console.log('═'.repeat(80));
            console.log(`✅ ICLOCK HANDSHAKE - SN: ${SN}`);
            console.log('═'.repeat(80));
            console.log(`PushVer: ${pushver} | Lang: ${language}`);
            console.log('Sending optimized configuration...');
            console.log('═'.repeat(80));
            console.log('\n');

            const config = [
                'GET_PROTOCOL=1',
                'RegistryCode=1',
                'TransInterval=1',
                'LogInterval=1',
                'TransFlag=1111111111',
                'Realtime=1',
                'Encrypt=0',
                'ServerVer=3.4.1',
                `PushProtVer=${pushver || '3.4.1'}`,
                'ErrorDelay=3',
                'Delay=10',
                'TransTimes=00:00;23:59',
                'TimeZone=330',
                'DaylightSavingTime=0'
            ].join('\n');
            return res.send(config);
        }

        // Standard response
        res.send(ADMS_OK);

    } catch (error) {
        logger.error(`ICLOCK990 Handshake Error [${SN}]:`, error);
        res.status(500).send(ADMS_ERROR);
    }
});

/**
 * POST /iclock/devicecmd
 * Device sends command execution results here
 */
router.post(['/devicecmd', '/devicecmd.aspx', '/devicecmd/return'], async (req, res) => {
    const { SN } = req.query;
    const clientIp = getClientIp(req);
    const body = req.body;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);

    logger.info(`ADMS Command Result: SN=${SN} from ${clientIp}: ${bodyStr}`);

    try {
        // Ensure body is a string for parsing
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);

        await AdmsRawLog.create({
            serialNumber: SN || 'UNKNOWN',
            table: 'CMD_RESULT',
            query: req.query,
            body: bodyStr,
            method: 'POST',
            ipAddress: clientIp
        });

        // Parse result if possible
        // Format of result body usually: ID=XXX&Return=0 (or 1, etc)
        const resultMatch = bodyStr.match(/ID=([^&]*)/);
        const returnMatch = bodyStr.match(/Return=([^&]*)/);

        if (resultMatch) {
            const cmdPartialId = resultMatch[1];
            const returnVal = returnMatch ? returnMatch[1] : 'unknown';

            // Find the most recent SENT command for this device
            // Since we use slice(-6) in getrequest, we search for partial match
            const cmd = await DeviceCommand.findOne({
                deviceId: SN,
                status: 'SENT'
            }).sort({ sentAt: -1 });

            if (cmd && cmd._id.toString().endsWith(cmdPartialId)) {
                cmd.status = returnVal === '0' || returnVal === 'OK' ? 'SUCCESS' : 'FAIL';
                cmd.result = body;
                cmd.completedAt = new Date();
                await cmd.save();
                logger.info(`ADMS Command Acknowledged: [${SN}] CMD_ID=${cmdPartialId} Status=${cmd.status}`);
            }
        }

        // Always respond OK so device clears its command queue
        res.send(ADMS_OK);
    } catch (error) {
        logger.error(`ADMS Command Result Error [${SN}]:`, error);
        res.status(500).send(ADMS_ERROR);
    }
});

/**
 * POST /iclock/getrequest (Alternative upload)
 */
router.post(['/getrequest', '/getrequest.aspx'], async (req, res) => {
    const { SN } = req.query;
    const clientIp = getClientIp(req);
    logger.info(`ADMS Extra Info/Keep-alive: SN=${SN} from ${clientIp}`);

    try {
        await AdmsRawLog.create({
            serialNumber: SN || 'UNKNOWN',
            table: 'KEEPALIVE',
            query: req.query,
            body: req.body || '',
            method: 'POST',
            ipAddress: clientIp
        });
        await touchDeviceHeartbeat(SN);
    } catch (err) {
        logger.error(`ADMS Keep-alive Log Error: ${err.message}`);
    }

    res.send(ADMS_OK);
});

const getClientIp = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0] ||
        req.socket.remoteAddress ||
        req.ip;
};

/** Updates lastSeenAt on any ADMS heartbeat / handshake / data push (for live online UI). */
async function touchDeviceHeartbeat(SN) {
    if (!SN || SN === 'UNKNOWN') return;
    try {
        await Device.updateOne(
            { deviceId: SN },
            { $set: { lastSeenAt: new Date() } }
        );
    } catch (err) {
        logger.warn(`touchDeviceHeartbeat failed for ${SN}: ${err.message}`);
    }
}

/**
 * HELPER: Ensure device is registered and visible
 */
async function ensureDeviceRegistered(SN, clientIp) {
    if (!SN || SN === 'UNKNOWN') return null;

    const cleanedIp = (clientIp || '').replace('::ffff:', '');

    try {
        let device = await Device.findOne({ deviceId: SN });

        if (device) {
            // Update IP if it has changed
            if (device.ip !== cleanedIp && cleanedIp) {
                const oldIp = device.ip;
                device.ip = cleanedIp;
                await device.save();
                logger.info(`ADMS: Device ${device.name} (${SN}) IP updated: ${oldIp} -> ${cleanedIp}`);
            }
        } else {
            // New Device - Create it
            const count = await Device.countDocuments({ name: /^Auto-ADMS-/ });
            const newName = `Auto-ADMS-${count + 1}`;

            logger.info(`ADMS: New device detected! [${SN}] from IP: ${cleanedIp}`);

            device = await Device.create({
                deviceId: SN,
                name: newName,
                ip: cleanedIp || '0.0.0.0',
                port: 4370,
                enabled: true,
                location: 'Auto-Registered'
            });
            logger.info(`ADMS: Successfully created new device: ${newName} (${SN})`);
        }
        return device;
    } catch (err) {
        logger.error(`ADMS: Error in ensureDeviceRegistered for ${SN}:`, err);
        return { name: `Unregistered-${SN}`, deviceId: SN };
    }
}

/**
 * POST /iclock/cdata
 * Primary data upload endpoint
 */
router.post(['/cdata', '/cdata.aspx', '/push'], async (req, res) => {
    const { SN, table } = req.query;
    const clientIp = getClientIp(req);

    // FAIL-SAFE: If body-parser failed to capture text data
    if (!req.body || typeof req.body !== 'string' || Object.keys(req.body).length === 0) {
        // Attempt manual capture if not already parsed
        let rawData = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => { rawData += chunk; });
        req.on('end', async () => {
            req.body = rawData;
            await processAdmsPost(req, res, SN, table, clientIp);
        });
        return;
    }

    await processAdmsPost(req, res, SN, table, clientIp);
});

/**
 * Process the ADMS POST request logic
 */
async function processAdmsPost(req, res, SN, table, clientIp) {
    const rawBody = req.body;

    try {
        // CRITICAL: Always log and store raw data for visual inspection later
        await AdmsRawLog.create({
            serialNumber: SN || 'UNKNOWN',
            table: table || 'UNKNOWN',
            query: req.query,
            body: rawBody,
            method: 'POST',
            ipAddress: clientIp
        });

        logger.info(`ADMS Data: SN=${SN}, Table=${table}, Size=${rawBody?.length || 0} chars`);

        await touchDeviceHeartbeat(SN);

        // ==========================================
        // DEBUG: Show RAW body data
        // ==========================================
        console.log('\n');
        console.log('═'.repeat(80));
        console.log(`RAW BODY DEBUG - SN: ${SN}, Table: ${table}`);
        console.log('═'.repeat(80));
        console.log(`Type: ${typeof rawBody}`);
        console.log(`Is Array: ${Array.isArray(rawBody)}`);
        console.log(`Is String: ${typeof rawBody === 'string'}`);
        console.log(`Length: ${rawBody?.length || 'N/A'}`);
        console.log('Raw Body Content:');
        console.log(JSON.stringify(rawBody, null, 2));
        console.log('Raw Body (direct):');
        console.log(rawBody);
        console.log('═'.repeat(80));
        console.log('\n');

        if (table === 'ATTLOG') {
            const records = admsParser.parseTextRecords(rawBody);

            // AUTO-REGISTRATION / UPDATE LOGIC
            const device = await ensureDeviceRegistered(SN, clientIp);
            const deviceName = device?.name || `Unregistered-${SN}`;

            const LOG_TYPE_MAP = {
                0: 'CHECK-IN',
                1: 'CHECK-OUT',
                2: 'BREAK-OUT',
                3: 'BREAK-IN',
                4: 'OVERTIME-IN',
                5: 'OVERTIME-OUT',
                255: 'CHECK-IN'
            };

            const bulkOps = records.map(rec => {
                const logType = LOG_TYPE_MAP[rec.inOutMode] || 'CHECK-IN';
                return {
                    updateOne: {
                        filter: { employeeId: rec.userId, timestamp: rec.timestamp }, // Unique by User + Time
                        update: {
                            $set: {
                                logType,
                                rawType: rec.inOutMode,
                                rawData: rec,
                                deviceName,
                                deviceId: SN,
                                syncedAt: new Date()
                            }
                        },
                        upsert: true
                    }
                };
            });

            if (bulkOps.length > 0) {
                try {
                    const result = await AttendanceLog.bulkWrite(bulkOps);
                    logger.info(`ADMS Bulk Write [${SN}]: Matched ${result.matchedCount}, Modified ${result.modifiedCount}, Upserted ${result.upsertedCount}`);

                    // ==========================================
                    // REAL-TIME SYNC TRIGGER (Microservice -> Backend)
                    // ==========================================
                    try {
                        const axios = require('axios'); // Lazy load
                        const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
                        const syncEndpoint = `${BACKEND_URL}/api/internal/attendance/sync`;
                        const SYSTEM_KEY = process.env.HRMS_MICROSERVICE_SECRET_KEY || "hrms-secret-key-2026-abc123xyz789";
                        if (!SYSTEM_KEY) {
                            logger.error('HRMS_MICROSERVICE_SECRET_KEY not configured in biometric service');
                            return;
                        }

                        const syncPayload = records.map(rec => {
                            const logType = LOG_TYPE_MAP[rec.inOutMode] || 'CHECK-IN';
                            return {
                                employeeId: rec.userId,
                                timestamp: rec.timestamp,
                                logType: logType,
                                deviceId: SN,
                                deviceName: deviceName,
                                rawStatus: rec.inOutMode
                            };
                        });

                        axios.post(syncEndpoint, syncPayload, {
                            headers: { 'x-system-key': SYSTEM_KEY },
                            timeout: 5000
                        })
                            .then(response => {
                                logger.info(`ADMS Real-Time Sync Success: Backend accepted ${response.data.processed} logs.`);
                            })
                            .catch(err => {
                                const errorReason = err.code === 'ECONNREFUSED' ? `Connection refused at ${syncEndpoint}` : err.message;
                                logger.error(`ADMS Real-Time Sync Failed: ${errorReason}`);
                            });

                    } catch (syncError) {
                        logger.error(`ADMS Real-Time Trigger Error: ${syncError.message}`);
                    }
                } catch (bulkErr) {
                    logger.error(`ADMS Bulk Write Error:`, bulkErr);
                }
            }

            return res.send(`OK: ${records.length}`);
        }

        // ==========================================
        // DEVICE HEALTH & STATUS MONITORING
        // ==========================================
        if (typeof rawBody === 'string' && (rawBody.includes('~DeviceName=') || rawBody.includes('TransactionCount='))) {
            const statusData = admsParser.parseDeviceStatus(rawBody);
            if (statusData) {
                await Device.findOneAndUpdate(
                    { deviceId: SN },
                    {
                        $set: {
                            status: {
                                userCount: parseInt(statusData.UserCount) || 0,
                                fingerCount: parseInt(statusData.FPCount) || 0,
                                attCount: parseInt(statusData.TransactionCount) || 0,
                                faceCount: parseInt(statusData.FaceCount) || 0,
                                firmware: statusData.FWVersion,
                                platform: statusData.Platform,
                                rawStatus: rawBody
                            },
                            // Auto-Discover Capabilities
                            capabilities: {
                                hasFingerprint: statusData.FingerFunOn === '1',
                                hasFace: statusData.FaceFunOn === '1',
                                hasPalm: statusData.PvFunOn === '1',
                                hasCard: !!statusData.CARD,
                                fpVersion: statusData.FPVersion || '10',
                                faceVersion: statusData.FaceVersion,
                                maxUsers: parseInt(statusData.MaxUserCount),
                                maxFingers: parseInt(statusData.MaxFingerCount),
                                maxAttLogs: parseInt(statusData.MaxAttLogCount)
                            },
                            protocol: {
                                pushVersion: statusData.PushVersion,
                                // Adjust protocol based on hardware platform if needed
                                separator: statusData.Platform?.includes('ZMM100') ? ',' : '\t'
                            },
                            lastSeenAt: new Date()
                        }
                    },
                    { upsert: true }
                );
                logger.info(`ADMS: Updated health status for device ${SN} (${statusData.UserCount} Users, ${statusData.TransactionCount} Logs)`);
                // We've processed the main logic for this packet, but let it fall through 
                // to generic handling if needed. For now, keep it silent like other handlers.
            }
        }

        // ==========================================
        // STRUCTURED BIOMETRIC DATA HANDLING
        // ==========================================

        // Handle User Informatiom
        if (table === 'USERINFO' || table === 'USER') {
            const lines = rawBody.split('\n');
            let count = 0;
            for (const line of lines) {
                const cleanLine = line.replace(/^(USER)\s+/, '').trim();
                const data = admsParser.parseKeyValueLine(cleanLine);
                if (data && data.PIN) {
                    const userId = data.PIN;
                    await DeviceUser.findOneAndUpdate(
                        { userId: userId },
                        {
                            $set: {
                                userId: userId,
                                name: data.NAME || '',
                                password: data.PASSWORD || '',
                                card: data.CARD || '',
                                role: parseInt(data.ROLE) || 0,
                                lastSyncedAt: new Date(),
                                lastDeviceId: SN
                            }
                        },
                        { upsert: true }
                    );
                    count++;
                    // Trigger Auto-Sync for new user info
                    autoCloneUser(userId, SN);
                }
            }
            logger.info(`ADMS: Parsed and updated ${count} User records from SN: ${SN}`);
            return res.send(ADMS_OK);
        }

        // Handle Fingerprint Templates
        if (table === 'FINGERTMP' || table === 'FP' || (table === 'OPERLOG' && rawBody.includes('FP PIN='))) {
            const fingerprints = admsParser.parseBiometricData(rawBody);
            if (fingerprints.length > 0) {
                for (const fp of fingerprints) {
                    // First remove existing template for this index to avoid duplicates in the array
                    await DeviceUser.updateOne(
                        { userId: fp.userId },
                        { $pull: { fingerprints: { fingerIndex: fp.fingerIndex } } }
                    );
                    // Then push the new one
                    await DeviceUser.updateOne(
                        { userId: fp.userId },
                        {
                            $push: {
                                fingerprints: {
                                    fingerIndex: fp.fingerIndex,
                                    templateData: fp.template,
                                    updatedAt: new Date()
                                }
                            },
                            $set: {
                                lastSyncedAt: new Date(),
                                lastDeviceId: SN
                            }
                        },
                        { upsert: true }
                    );
                    // Trigger Auto-Sync for new fingerprint
                    autoCloneUser(fp.userId, SN);
                }
                logger.info(`ADMS: Parsed and updated ${fingerprints.length} Fingerprint records from SN: ${SN} (Table: ${table})`);
                return res.send(ADMS_OK);
            }
        }

        // Handle Face Templates
        if (table === 'FACE') {
            const faces = admsParser.parseBiometricData(rawBody);
            for (const face of faces) {
                await DeviceUser.findOneAndUpdate(
                    { userId: face.userId },
                    {
                        $set: {
                            userId: face.userId,
                            face: {
                                templateData: face.template,
                                length: face.size,
                                updatedAt: new Date()
                            },
                            lastSyncedAt: new Date(),
                            lastDeviceId: SN
                        }
                    },
                    { upsert: true }
                );
            }
            logger.info(`ADMS: Parsed and updated ${faces.length} Face records from SN: ${SN}`);
            return res.send(ADMS_OK);
        }

        // Handle User Photos (USERPIC)
        if (table === 'USERPIC') {
            const lines = rawBody.split('\n');
            for (const line of lines) {
                const data = admsParser.parseKeyValueLine(line);
                if (data && data.PIN) {
                    const userId = data.PIN;
                    await DeviceUser.findOneAndUpdate(
                        { userId: userId },
                        {
                            $set: {
                                userId: userId,
                                photo: {
                                    content: data.CONTENT || '',
                                    fileName: data.FILENAME || '',
                                    size: parseInt(data.SIZE) || 0,
                                    updatedAt: new Date()
                                },
                                lastSyncedAt: new Date(),
                                lastDeviceId: SN
                            }
                        },
                        { upsert: true }
                    );
                    // Trigger Auto-Sync for new photo
                    autoCloneUser(userId, SN);
                }
            }
            logger.info(`ADMS: Parsed and updated User Photos from SN: ${SN}`);
            return res.send(ADMS_OK);
        }

        // Generic support for other tables (OPERLOG, etc.)
        if (['OPERLOG', 'ERRORLOG'].includes(table)) {
            logger.info(`ADMS Data [${table}] received from SN: ${SN}. Storing in Raw Logs.`);
            return res.send(ADMS_OK);
        }

        // Echo OK for unknown tables
        res.send(ADMS_OK);

    } catch (error) {
        logger.error(`ADMS Process Error [${SN}]:`, error);
        res.status(500).send(ADMS_ERROR);
    }
}

/**
 * GET /api/adms/users
 * Returns structured device users with biometric info
 */
router.get('/users', async (req, res) => {
    try {
        const { sn } = req.query;
        const query = {};
        if (sn) query.lastDeviceId = sn;

        const users = await DeviceUser.find(query).sort({ userId: 1 });
        res.json({ success: true, count: users.length, data: users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/adms/command
 * Public API to queue a command for a device
 */
router.post('/command', async (req, res) => {
    try {
        const { deviceId, command } = req.body;

        if (!deviceId || !command) {
            return res.status(400).json({ success: false, error: 'deviceId and command are required' });
        }

        const newCommand = await DeviceCommand.create({
            deviceId,
            command,
            status: 'PENDING'
        });

        logger.info(`ADMS Command Queued: [${deviceId}] -> ${command}`);

        res.json({
            success: true,
            commandId: newCommand._id,
            status: 'PENDING'
        });
    } catch (error) {
        logger.error('Error queuing ADMS command:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/adms/clone-user
 * Clone a user's profile and fingerprints to a target machine
 */
router.post('/clone-user', async (req, res) => {
    try {
        const { userId, targetDeviceId } = req.body;

        if (!userId || !targetDeviceId) {
            return res.status(400).json({ success: false, error: 'userId and targetDeviceId are required' });
        }

        // 1. Get the user from DB
        const user = await DeviceUser.findOne({ userId });
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // 2. Queue User Profile Command
        const targetDevice = await Device.findOne({ deviceId: targetDeviceId });
        const sep = targetDevice?.protocol?.separator || '\t';

        const userCmd = `DATA UPDATE USERINFO PIN=${user.userId}${sep}Name=${user.name || ''}${sep}Password=${user.password || ''}${sep}Group=1${sep}Card=${user.card || ''}${sep}Role=${user.role || 0}`;

        await DeviceCommand.create({
            deviceId: targetDeviceId,
            command: userCmd,
            status: 'PENDING'
        });

        // 3. Queue Fingerprint Commands
        if (user.fingerprints && user.fingerprints.length > 0) {
            for (const fp of user.fingerprints) {
                const fpCmd = `DATA UPDATE FINGERTMP PIN=${user.userId}${sep}FID=${fp.fingerIndex}${sep}Size=${fp.templateData.length}${sep}Valid=1${sep}TMP=${fp.templateData}`;
                await DeviceCommand.create({
                    deviceId: targetDeviceId,
                    command: fpCmd,
                    status: 'PENDING'
                });
            }
        }

        // 4. Queue Photo Command
        if (user.photo && user.photo.content) {
            const photoCmd = `DATA UPDATE USERPIC PIN=${user.userId}${sep}FileName=${user.photo.fileName || (user.userId + '.jpg')}${sep}Size=${user.photo.content.length}${sep}Content=${user.photo.content}`;
            await DeviceCommand.create({
                deviceId: targetDeviceId,
                command: photoCmd,
                status: 'PENDING'
            });
        }

        // 4. Queue Face Data if exists
        if (user.face && user.face.templateData) {
            const faceCmd = `DATA UPDATE FACE PIN=${user.userId}\tFID=0\tSize=${user.face.length}\tValid=1\tTMP=${user.face.templateData}`;
            await DeviceCommand.create({
                deviceId: targetDeviceId,
                command: faceCmd,
                status: 'PENDING'
            });
        }

        logger.info(`ADMS Clone: User ${userId} queued for device ${targetDeviceId}`);
        res.json({ success: true, message: `User ${userId} profile and ${user.fingerprints?.length || 0} fingerprints queued for cloning to device ${targetDeviceId}` });
    } catch (error) {
        logger.error('Error cloning user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /logs
 * Unified endpoint to query any ADMS table data (USER, FINGERTMP, OPERLOG, etc.)
 */
router.get('/logs', async (req, res) => {
    try {
        const { sn, table, start, end, limit } = req.query;
        const query = {};

        if (sn) query.serialNumber = sn;
        if (table) query.table = table;

        if (start || end) {
            query.receivedAt = {};
            if (start) query.receivedAt.$gte = new Date(start);
            if (end) query.receivedAt.$lte = new Date(end);
        }

        const logLimit = parseInt(limit) || 100;

        const logs = await AdmsRawLog.find(query)
            .sort({ receivedAt: -1 })
            .limit(logLimit);

        res.json({
            success: true,
            count: logs.length,
            filters: { sn, table, start, end, limit: logLimit },
            data: logs
        });
    } catch (error) {
        logger.error('Error fetching ADMS logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /raw (LEGACY - keep for backward compatibility)
 */
router.get('/raw', async (req, res) => {
    // Redirect to the public unified endpoint
    res.redirect(`/api/adms/logs?limit=${req.query.limit || 50}`);
});

/**
 * HELPER: Auto-clone a user/template to all other devices
 */
async function autoCloneUser(userId, sourceSN) {
    if (process.env.AUTO_CLONE_NEW_USERS !== 'true') return;

    try {
        const user = await DeviceUser.findOne({ userId });
        if (!user) return;

        const devices = await Device.find({ deviceId: { $ne: sourceSN }, enabled: true });
        if (devices.length === 0) return;

        logger.info(`ADMS Auto-Sync: Distributing user ${userId} to ${devices.length} other devices.`);

        for (const device of devices) {
            const sep = device.protocol?.separator || '\t';
            // Queue Profile
            const userCmd = `DATA UPDATE USERINFO PIN=${user.userId}${sep}Name=${user.name || ''}${sep}Password=${user.password || ''}${sep}Group=1${sep}Card=${user.card || ''}${sep}Role=${user.role || 0}`;
            await DeviceCommand.create({ deviceId: device.deviceId, command: userCmd, status: 'PENDING' });

            // Queue Fingerprints
            if (user.fingerprints && user.fingerprints.length > 0) {
                for (const fp of user.fingerprints) {
                    const fpCmd = `DATA UPDATE FINGERTMP PIN=${user.userId}${sep}FID=${fp.fingerIndex}${sep}Size=${fp.templateData.length}${sep}Valid=1${sep}TMP=${fp.templateData}`;
                    await DeviceCommand.create({ deviceId: device.deviceId, command: fpCmd, status: 'PENDING' });
                }
            }

            // Queue Photo
            if (user.photo && user.photo.content) {
                const photoCmd = `DATA UPDATE USERPIC PIN=${user.userId}${sep}FileName=${user.photo.fileName || (user.userId + '.jpg')}${sep}Size=${user.photo.content.length}${sep}Content=${user.photo.content}`;
                await DeviceCommand.create({ deviceId: device.deviceId, command: photoCmd, status: 'PENDING' });
            }
        }
    } catch (err) {
        logger.error(`ADMS Auto-Sync Error for user ${userId}:`, err);
    }
}

module.exports = router;

