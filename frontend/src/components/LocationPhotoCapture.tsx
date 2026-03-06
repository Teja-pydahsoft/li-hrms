import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import exifr from 'exifr';
import { MapPin, XCircle, AlertCircle } from 'lucide-react';

const LocationMap = dynamic(() => import('@/components/LocationMap'), { ssr: false });

interface LocationData {
    latitude: number;
    longitude: number;
    accuracy?: number;
    address?: string;
    capturedAt: Date;
    source?: 'device' | 'exif' | 'hybrid';
}

interface PhotoEvidenceData {
    file: File;
    previewUrl: string;
    exifLocation?: {
        latitude: number;
        longitude: number;
    };
    locationVerificationStatus?: 'verified' | 'mismatch' | 'unknown'; // Result of comparison
    distanceToDevice?: number; // in meters
}

interface LocationPhotoCaptureProps {
    onCapture: (location: LocationData, photo: PhotoEvidenceData) => void;
    onClear: () => void;
    label?: string;
    required?: boolean;
}

// Haversine formula to calculate distance between two points in meters
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

export default function LocationPhotoCapture({
    onCapture,
    onClear,
    label = "Photo Evidence",
    required = false
}: LocationPhotoCaptureProps) {
    const [loading, setLoading] = useState(false);
    const [loadingStep, setLoadingStep] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
    const [permissionDeniedAtFetch, setPermissionDeniedAtFetch] = useState(false);
    const [locationUnavailableAtFetch, setLocationUnavailableAtFetch] = useState(false);
    const [pendingFile, setPendingFile] = useState<File | null>(null);

    // Separate refs for different capture modes
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);

    const [deviceLocation, setDeviceLocation] = useState<LocationData | null>(null);
    const [exifLocation, setExifLocation] = useState<{ latitude: number; longitude: number; } | null>(null);
    const [verificationStatus, setVerificationStatus] = useState<'verified' | 'mismatch' | 'unknown'>('unknown');
    const [distance, setDistance] = useState<number | null>(null);
    const [address, setAddress] = useState<string | null>(null);
    const [showCamera, setShowCamera] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Effect to handle video stream assignment when modal opens
    useEffect(() => {
        if (showCamera && streamRef.current && videoRef.current) {
            videoRef.current.srcObject = streamRef.current;
        }
    }, [showCamera]);

    // Helper to get device location
    const getDeviceLocation = (): Promise<LocationData> => {
        return new Promise((resolve, reject) => {
            if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost') {
                reject(new Error('Location access is blocked on insecure connections (HTTP). Please use HTTPS or localhost.'));
                return;
            }

            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported by this browser.'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        capturedAt: new Date(),
                        source: 'device'
                    });
                },
                (err) => {
                    let msg = 'Failed to get location.';
                    if (err.code === 1) msg = 'Location permission denied.';
                    else if (err.code === 2) msg = 'Location unavailable.';
                    else if (err.code === 3) msg = 'Location request timed out.';
                    reject(new Error(msg));
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        });
    };

    // Helper for reverse geocoding
    const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`, {
                headers: {
                    'Accept-Language': 'en',
                    'User-Agent': 'HRMS-App' // Required by Nominatim policy
                }
            });
            const data = await response.json();
            return data.display_name || 'Address not found';
        } catch (error) {
            console.error('Reverse geocoding error:', error);
            return 'Could not resolve address';
        }
    };

    const checkPermissionStatus = async (): Promise<PermissionState> => {
        if (typeof navigator !== 'undefined' && navigator.permissions) {
            try {
                const result = await navigator.permissions.query({ name: 'geolocation' as any });
                return result.state;
            } catch (e) {
                return 'prompt';
            }
        }
        return 'prompt';
    };

    const handleFileProcessing = async (file: File) => {
        if (!file) return;

        const permission = await checkPermissionStatus();
        if (permission === 'prompt') {
            setPendingFile(file);
            setShowPermissionPrompt(true);
            return;
        }

        if (permission === 'denied') {
            setPermissionDeniedAtFetch(true);
            setShowPermissionPrompt(true);
            return;
        }

        await proceedWithProcessing(file);
    };

    const proceedWithProcessing = async (file: File) => {
        setLoading(true);
        setError(null);
        setLoadingStep('Initializing...');

        try {
            // 1. Get Device Location (Parallel with processing if possible, but sequential is safer for error handling)
            setLoadingStep('Acquiring Device Location...');
            let locData: LocationData;
            try {
                locData = await getDeviceLocation();
                setDeviceLocation(locData);

                // Fetch Address
                setLoadingStep('Resolving Address...');
                const addr = await reverseGeocode(locData.latitude, locData.longitude);
                locData.address = addr;
                setAddress(addr);
            } catch (locErr: any) {
                console.warn('Could not get device location:', locErr);
                if (locErr.message.includes('permission denied')) {
                    setPermissionDeniedAtFetch(true);
                    setShowPermissionPrompt(true);
                } else if (locErr.message.includes('unavailable')) {
                    setLocationUnavailableAtFetch(true);
                    setShowPermissionPrompt(true);
                }
                throw new Error(`Location required: ${locErr.message}`);
            }

            // 2. Parse EXIF from Photo
            setLoadingStep('Analyzing Photo Metadata...');
            let extractedExifLoc: { latitude: number; longitude: number } | undefined = undefined;
            try {
                const gps = await exifr.gps(file);
                if (gps) {
                    extractedExifLoc = {
                        latitude: gps.latitude,
                        longitude: gps.longitude,
                    };
                    setExifLocation(extractedExifLoc);
                } else {
                    setExifLocation(null);
                }
            } catch (exifErr) {
                console.warn('Failed to extract EXIF:', exifErr);
                setExifLocation(null);
            }

            // 3. Verify Location Coherence
            setLoadingStep('Verifying Coherence...');
            let status: 'verified' | 'mismatch' | 'unknown' = 'unknown';
            let dist: number | undefined = undefined;

            if (extractedExifLoc && locData) {
                dist = calculateDistance(
                    locData.latitude,
                    locData.longitude,
                    extractedExifLoc.latitude,
                    extractedExifLoc.longitude
                );
                setDistance(dist);

                // Threshold: 500 meters (allow for some drift/cell tower triangulation errors)
                if (dist < 500) {
                    status = 'verified';
                } else {
                    status = 'mismatch';
                }
            } else {
                // If we have device location but no EXIF, we rely on device location (common for webcams/screenshots)
                status = 'unknown';
                setDistance(null);
            }
            setVerificationStatus(status);

            // 4. Create Preview
            setLoadingStep('Generating Preview...');
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                setPreview(result);

                // 5. Callback
                onCapture(locData, {
                    file,
                    previewUrl: result,
                    exifLocation: extractedExifLoc,
                    locationVerificationStatus: status,
                    distanceToDevice: dist
                });
                setLoading(false);
                setLoadingStep('');
            };
            reader.readAsDataURL(file);

        } catch (err: any) {
            setError(err.message || 'Failed to capture photo/location');
            setLoading(false);
            setLoadingStep('');
            // Reset inputs
            if (cameraInputRef.current) cameraInputRef.current.value = '';
            if (uploadInputRef.current) uploadInputRef.current.value = '';
        }
    };

    const startCamera = async () => {
        try {
            setError(null);
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
                audio: false
            });
            streamRef.current = stream;
            setShowCamera(true);
        } catch (err: any) {
            console.error('Camera access error:', err);
            let msg = 'Could not access camera.';
            if (err.name === 'NotAllowedError') msg = 'Camera permission denied.';
            else if (err.name === 'NotFoundError') msg = 'No camera found on this device.';
            setError(msg);
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setShowCamera(false);
    };

    const capturePhoto = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');

            if (context) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                context.drawImage(video, 0, 0, canvas.width, canvas.height);

                canvas.toBlob((blob) => {
                    if (blob) {
                        const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
                        handleFileProcessing(file);
                        stopCamera();
                    }
                }, 'image/jpeg', 0.9);
            }
        }
    };

    const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFileProcessing(file);
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFileProcessing(file);
    };

    const handleClear = () => {
        setPreview(null);
        setDeviceLocation(null);
        setExifLocation(null);
        setVerificationStatus('unknown');
        setDistance(null);
        setAddress(null);
        setError(null);
        setPermissionDeniedAtFetch(false);
        setLocationUnavailableAtFetch(false);
        if (cameraInputRef.current) cameraInputRef.current.value = '';
        if (uploadInputRef.current) uploadInputRef.current.value = '';
        onClear();
    };

    const isSecure = typeof window !== 'undefined' && (window.isSecureContext || window.location.hostname === 'localhost');

    return (
        <div className="space-y-3 relative">
            {!isSecure && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 flex items-start gap-2">
                    <svg className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="text-xs text-amber-700 dark:text-amber-400">
                        <p className="font-bold">Insecure Connection Detected</p>
                        <p>Camera and Location features are restricted by your browser on non-HTTPS connections (IP address). Please use <b>localhost</b> or <b>HTTPS</b>.</p>
                    </div>
                </div>
            )}
            <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {label} {required && <span className="text-red-500">*</span>}
                </label>
                {deviceLocation && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800">
                        GPS Active
                    </span>
                )}
            </div>

            {!preview ? (
                <div className="relative">
                    {/* Hidden Inputs */}
                    <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment" // Forces camera on mobile
                        onChange={handleCameraCapture}
                        className="hidden"
                        id="camera-input"
                    />
                    <input
                        ref={uploadInputRef}
                        type="file"
                        accept="image/*"
                        // No capture attribute - opens file picker
                        onChange={handleFileUpload}
                        className="hidden"
                        id="upload-input"
                    />

                    {loading ? (
                        <div className="flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/10 transition-all">
                            <div className="relative mb-3">
                                <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                                </div>
                            </div>
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 animate-pulse">
                                {loadingStep || 'Processing...'}
                            </span>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {/* Primary Upload Area - Large, Dashed Dropzone */}
                            <label
                                htmlFor="upload-input"
                                className="group relative cursor-pointer flex flex-col items-center justify-center p-4 sm:p-8 rounded-2xl sm:rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-blue-400 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:bg-slate-800 dark:hover:border-blue-600 transition-all duration-300 min-h-[100px] sm:min-h-[160px]"
                            >
                                <div className="mb-2 sm:mb-4 p-3 sm:p-4 rounded-full bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700 group-hover:scale-110 transition-transform duration-300">
                                    <svg className="h-6 w-6 sm:h-8 sm:w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                    </svg>
                                </div>
                                <div className="text-center">
                                    <span className="block text-sm sm:text-base font-semibold text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                        Click to Upload Photo
                                    </span>
                                    <span className="mt-0.5 sm:mt-1 block text-[10px] sm:text-sm text-slate-500 dark:text-slate-400">
                                        JPG, PNG (Max 20MB)
                                    </span>
                                </div>
                            </label>

                            {/* Secondary Action - Take Photo Button */}
                            <div className="flex items-center justify-center">
                                <span className="text-[10px] sm:text-xs text-slate-400 uppercase font-medium px-3">OR</span>
                            </div>

                            <button
                                type="button"
                                onClick={startCamera}
                                className="flex items-center justify-center gap-2 p-2.5 sm:p-3 rounded-xl bg-white border border-slate-200 shadow-sm hover:bg-slate-50 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700 transition-all active:scale-95"
                            >
                                <svg className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                <span className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200">
                                    Take Photo with Camera
                                </span>
                            </button>

                            {error && (
                                <div className="p-3 rounded-xl bg-red-50 border border-red-100 dark:bg-red-900/20 dark:border-red-800 flex items-start gap-2 animate-shake">
                                    <svg className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex flex-col sm:flex-row gap-4 p-4">
                        <div className="relative group shrink-0">
                            <img
                                src={preview}
                                alt="Evidence Preview"
                                className="w-full h-48 sm:h-24 sm:w-24 rounded-xl object-cover ring-2 ring-white dark:ring-slate-700 shadow-md"
                            />
                            <div className="absolute inset-0 bg-black/20 rounded-xl hidden group-hover:block transition-all" />
                        </div>

                        <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                            <div>
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Evidence Captured</h4>
                                <div className="mt-2 space-y-1.5">
                                    {/* Verification Status Badge */}
                                    {verificationStatus === 'verified' && (
                                        <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-lg w-fit">
                                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <span className="font-semibold">Location Verified</span>
                                            {distance !== null && <span className="opacity-75">({Math.round(distance)}m)</span>}
                                        </div>
                                    )}
                                    {verificationStatus === 'mismatch' && (
                                        <div className="flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg w-fit">
                                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                            <span className="font-bold">Location Mismatch!</span>
                                            {distance !== null && <span className="opacity-75">({Math.round(distance)}m diff)</span>}
                                        </div>
                                    )}
                                    {verificationStatus === 'unknown' && (
                                        <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-lg w-fit">
                                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                            </svg>
                                            <span className="font-medium">Device Location Only</span>
                                        </div>
                                    )}

                                    {address && (
                                        <div className="flex items-start gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                                            <svg className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                            </svg>
                                            <p className="line-clamp-2">{address}</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <button
                                onClick={handleClear}
                                className="self-start mt-2 px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-300 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition-colors flex items-center gap-1"
                            >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                Remove & Retake
                            </button>
                        </div>
                    </div>
                    {/* Grid Info */}
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-4 py-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-0 sm:divide-x divide-slate-200 dark:divide-slate-700">
                        <div className="sm:pr-4">
                            <span className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-0.5">Device Lat/Lon</span>
                            <span className="block text-xs font-mono text-slate-700 dark:text-slate-300">
                                {deviceLocation?.latitude.toFixed(6)}, {deviceLocation?.longitude.toFixed(6)}
                            </span>
                        </div>
                        <div className="sm:pl-4 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 dark:border-slate-800">
                            <span className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-0.5">Photo Lat/Lon</span>
                            <span className="block text-xs font-mono text-slate-700 dark:text-slate-300">
                                {exifLocation ? `${exifLocation.latitude.toFixed(6)}, ${exifLocation.longitude.toFixed(6)}` : 'N/A'}
                            </span>
                        </div>
                    </div>
                    {/* Map: show location they are in (Leaflet + OpenStreetMap) */}
                    {(deviceLocation || exifLocation) && (
                        <div className="p-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <span className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Location</span>
                            <LocationMap
                                latitude={(deviceLocation || exifLocation)!.latitude}
                                longitude={(deviceLocation || exifLocation)!.longitude}
                                address={address}
                                height="180px"
                                className="w-full"
                            />
                        </div>
                    )}
                </div>
            )}
            {/* Camera Modal */}
            {showCamera && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
                    <div className="relative w-full max-w-lg bg-slate-900 rounded-3xl overflow-hidden shadow-2xl ring-1 ring-white/10">
                        {/* Camera Header */}
                        <div className="absolute top-0 inset-x-0 p-4 flex justify-between items-center z-10 bg-gradient-to-b from-black/50 to-transparent">
                            <h3 className="text-white font-semibold text-sm">Capture Photo</h3>
                            <button
                                type="button"
                                onClick={stopCamera}
                                className="p-2 rounded-full bg-black/30 text-white hover:bg-black/50 transition-colors"
                            >
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Video Feed */}
                        <div className="relative aspect-[4/3] bg-black flex items-center justify-center">
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                onLoadedMetadata={() => videoRef.current?.play()}
                                className="w-full h-full object-cover"
                            />
                            {/* Overlay/Grid (Optional) */}
                            <div className="absolute inset-0 border-2 border-white/20 pointer-events-none rounded-2xl m-8"></div>
                        </div>

                        {/* Controls */}
                        <div className="p-6 bg-slate-900 flex flex-col items-center gap-4">
                            <button
                                type="button"
                                onClick={capturePhoto}
                                className="w-16 h-16 rounded-full bg-white border-4 border-slate-400 flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-xl"
                            >
                                <div className="w-12 h-12 rounded-full bg-white border-2 border-slate-200"></div>
                            </button>
                            <p className="text-slate-400 text-xs font-medium">Click button to take photo</p>
                        </div>
                    </div>

                    {/* Hidden Canvas for Capture */}
                    <canvas ref={canvasRef} className="hidden" />
                </div>
            )}

            {/* Permission Prompt Overlay (Local) */}
            {showPermissionPrompt && (
                <div className="absolute inset-0 z-[60] flex items-start justify-center p-2 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm rounded-2xl sm:rounded-3xl animate-in fade-in duration-300">
                    <div className="relative z-[61] w-full max-w-[300px] mt-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-4 sm:p-5 animate-in zoom-in-95 duration-300">
                        <div className="flex flex-col items-center text-center">
                            {permissionDeniedAtFetch ? (
                                <>
                                    <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-3">
                                        <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                                    </div>
                                    <h3 className="text-base font-black text-slate-900 dark:text-white mb-1">Location Denied</h3>
                                    <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-2 leading-relaxed">
                                        Enable location in settings to apply for OD.
                                    </p>
                                    <div className="w-full text-left mb-3">
                                        <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                                            <ol className="text-[10px] text-slate-600 dark:text-slate-400 space-y-1 list-decimal ml-4 text-left">
                                                <li>Click <b>lock icon</b> in URL bar.</li>
                                                <li>Set <b>Location</b> to <b>Allow</b>.</li>
                                                <li>Refresh page.</li>
                                            </ol>
                                        </div>
                                    </div>
                                </>
                            ) : locationUnavailableAtFetch ? (
                                <>
                                    <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-3">
                                        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                                    </div>
                                    <h3 className="text-base font-black text-slate-900 dark:text-white mb-1">GPS Unavailable</h3>
                                    <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                                        Enable <b>GPS</b> and ensure you have a signal.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-3">
                                        <MapPin className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                    </div>
                                    <h3 className="text-base font-black text-slate-900 dark:text-white mb-1">Location Required</h3>
                                    <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                                        Location is needed for OD. Allow access when prompted.
                                    </p>
                                </>
                            )}

                            <div className="flex flex-col w-full gap-2">
                                {(permissionDeniedAtFetch || locationUnavailableAtFetch) ? (
                                    <button
                                        onClick={() => {
                                            setShowPermissionPrompt(false);
                                            setPermissionDeniedAtFetch(false);
                                            setLocationUnavailableAtFetch(false);
                                            setPendingFile(null);
                                            handleClear();
                                        }}
                                        className="w-full py-2 px-4 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold hover:opacity-90 active:scale-[0.98] transition-all"
                                    >
                                        Got it
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            onClick={async () => {
                                                setShowPermissionPrompt(false);
                                                if (pendingFile) {
                                                    await proceedWithProcessing(pendingFile);
                                                    setPendingFile(null);
                                                }
                                            }}
                                            className="w-full py-2 px-4 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 active:scale-[0.98] transition-all"
                                        >
                                            Allow Access
                                        </button>
                                        <button
                                            onClick={() => {
                                                setShowPermissionPrompt(false);
                                                setPendingFile(null);
                                                handleClear();
                                            }}
                                            className="w-full py-1.5 px-4 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                                        >
                                            Cancel
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
