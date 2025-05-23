import React, { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";
import {
  allParagraphs,
  images,
  videos,
  sr,
  gola,
  all,
  instagramReels,
} from "./data";
// import a from './ab/1.jpg';

const App = () => {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [permissionError, setPermissionError] = useState("");
  const [recording, setRecording] = useState(false);
  const [videoURLs, setVideoURLs] = useState([]);
  const [status, setStatus] = useState("Initializing...");
  const [openSection, setOpenSection] = useState("notes");
  const [openMediaIndex, setOpenMediaIndex] = useState({
    photos: null,
    videos: null,
    recordings: null,
    reels: null,
    rec: null,
  });
  const [chunkCounter, setChunkCounter] = useState(1);
  const [uploadProgress, setUploadProgress] = useState(0);

  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const animationFrameRef = useRef(null);
  const screenStreamRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const isUploadingRef = useRef(false);
  const chunkIntervalRef = useRef(null);
  const screenVideoRef = useRef(null);
  const webcamVideoRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      clearInterval(chunkIntervalRef.current);
      cancelAnimationFrame(animationFrameRef.current);
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = null;
      }
    };
  }, []);

  // Initialize recording when component mounts
  useEffect(() => {
    const initialize = async () => {
      try {
        setStatus("Requesting permissions...");
        await requestPermissions();
      } catch (error) {
        console.error("Initialization error:", error);
        setStatus(`Initialization failed: ${error.message}`);
      }
    };
    initialize();
  }, []);

  // Start recording when permissions are granted
  useEffect(() => {
    if (permissionGranted && !recording) {
      startRecording();
    }
  }, [permissionGranted, recording]);

  // Drawing function for canvas
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const screenVideo = screenVideoRef.current;
    const webcamVideo = webcamVideoRef.current;

    if (!screenVideo || !webcamVideo) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    try {
      // Only draw if the video is ready
      if (screenVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
        // Draw screen capture
        ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);

        // Draw webcam overlay if ready
        if (webcamVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
          const webcamWidth = canvas.width / 5;
          const webcamHeight =
            (webcamVideo.videoHeight / webcamVideo.videoWidth) * webcamWidth;
          ctx.drawImage(
            webcamVideo,
            canvas.width - webcamWidth - 20,
            canvas.height - webcamHeight - 20,
            webcamWidth,
            webcamHeight
          );
        }
      }

      animationFrameRef.current = requestAnimationFrame(drawFrame);
    } catch (error) {
      console.error("Drawing error:", error);
    }
  }, []);

  // Request permissions
  const requestPermissions = async () => {
    try {
      // Request webcam permissions first
      const webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 },
        audio: true,
      });
      webcamStreamRef.current = webcamStream;

      // Create video element for webcam
      const webcamVideo = document.createElement("video");
      webcamVideoRef.current = webcamVideo;
      webcamVideo.srcObject = webcamStream;
      webcamVideo.autoplay = true;
      webcamVideo.playsInline = true;

      setPermissionGranted(true);
      setStatus("Webcam permissions granted - ready to record");
      return true;
    } catch (error) {
      setPermissionError(error.message);
      setStatus(`Permission error: ${error.message}`);
      console.error("Permission error:", error);
      return false;
    }
  };

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      if (!permissionGranted) {
        setStatus("Permissions not granted yet");
        return;
      }

      setStatus("Requesting screen sharing...");
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      screenStreamRef.current = screenStream;

      // Handle when user stops screen sharing
      screenStream.getVideoTracks()[0].onended = () => {
        setStatus("Screen sharing ended by user");
        stopRecording();
      };

      // Create video element for screen
      const screenVideo = document.createElement("video");
      screenVideoRef.current = screenVideo;
      screenVideo.srcObject = screenStream;
      screenVideo.autoplay = true;
      screenVideo.playsInline = true;

      // Setup canvas dimensions
      const canvas = canvasRef.current;

      // Wait for both videos to be ready
      await new Promise((resolve) => {
        let screenReady = false;
        let webcamReady = false;

        screenVideo.onloadedmetadata = () => {
          canvas.width = screenVideo.videoWidth;
          canvas.height = screenVideo.videoHeight;
          screenReady = true;
          if (screenReady && webcamReady) resolve();
        };

        webcamVideoRef.current.onloadedmetadata = () => {
          webcamReady = true;
          if (screenReady && webcamReady) resolve();
        };

        // Fallback in case metadata doesn't load
        setTimeout(resolve, 1000);
      });

      // Start drawing before creating the stream
      drawFrame();

      // Small delay to ensure frames are being drawn
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Create mixed stream from canvas
      const mixedStream = canvas.captureStream(30);

      // Verify the stream has video tracks
      if (mixedStream.getVideoTracks().length === 0) {
        throw new Error("No video tracks in mixed stream");
      }

      // Initialize MediaRecorder with supported mimeType
      const mimeTypes = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
        "video/mp4",
        "",
      ];

      const supportedType = mimeTypes.find(
        (type) => type === "" || MediaRecorder.isTypeSupported(type)
      );

      const options = {
        mimeType: supportedType,
        videoBitsPerSecond: 2500000, // 2.5 Mbps
      };

      const recorder = new MediaRecorder(mixedStream, options);
      mediaRecorderRef.current = recorder;

      // Handle data available
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      // Handle recording stop
      recorder.onstop = async () => {
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: options.mimeType });
          const url = URL.createObjectURL(blob);
          const name = `recording-${Date.now()}-part-${chunkCounter}`;

          setVideoURLs((prev) => [...prev, { url, name }]);
          await uploadToCloudinary(blob, name);
          setChunkCounter((prev) => prev + 1);
        }
      };

      // Start recording
      recorder.start(1000); // Request data every second for safety
      setRecording(true);
      setStatus("Recording started...");

      // Set up chunking interval (4 minutes)
      chunkIntervalRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.requestData();
          mediaRecorderRef.current.stop();

          // Immediately start new recording
          setTimeout(() => {
            if (screenStreamRef.current && webcamStreamRef.current) {
              startNewChunk();
            }
          }, 100);
        }
      }, 4 * 60 * 1000); // 4 minutes
    } catch (error) {
      setStatus(`Recording error: ${error.message}`);
      console.error("Recording error:", error);
      stopRecording();
    }
  }, [permissionGranted, drawFrame, chunkCounter]);

  const startNewChunk = () => {
    if (!screenStreamRef.current || !webcamStreamRef.current) return;

    try {
      const canvas = canvasRef.current;
      const mixedStream = canvas.captureStream(30);

      // Initialize MediaRecorder with supported mimeType
      const mimeTypes = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
        "video/mp4",
        "",
      ];

      const supportedType = mimeTypes.find(
        (type) => type === "" || MediaRecorder.isTypeSupported(type)
      );

      const options = {
        mimeType: supportedType,
        videoBitsPerSecond: 2500000, // 2.5 Mbps
      };

      const recorder = new MediaRecorder(mixedStream, options);
      mediaRecorderRef.current = recorder;

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: options.mimeType });
          const url = URL.createObjectURL(blob);
          const name = `recording-${Date.now()}-part-${chunkCounter}`;

          setVideoURLs((prev) => [...prev, { url, name }]);
          await uploadToCloudinary(blob, name);
          setChunkCounter((prev) => prev + 1);
        }
      };

      recorder.start(1000);
      setStatus(`Recording chunk ${chunkCounter + 1}...`);
    } catch (error) {
      console.error("Error starting new chunk:", error);
      stopRecording();
    }
  };

  const uploadToCloudinary = async (blob, name) => {
    if (isUploadingRef.current) return;

    isUploadingRef.current = true;
    setStatus(`Uploading ${name}...`);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("file", blob);
      formData.append(
        "upload_preset",
        import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
      );
      formData.append("cloud_name", import.meta.env.VITE_CLOUDINARY_CLOUD_NAME);
      formData.append("public_id", name);

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${
          import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
        }/video/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }

      const data = await response.json();
      setStatus(`${name} uploaded successfully`);
      return data.secure_url;
    } catch (error) {
      console.error("Upload error:", error);
      setStatus(`Upload failed: ${error.message}`);
      throw error;
    } finally {
      isUploadingRef.current = false;
      setUploadProgress(0);
    }
  };

  const stopRecording = useCallback(() => {
    clearInterval(chunkIntervalRef.current);
    cancelAnimationFrame(animationFrameRef.current);

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.requestData();
      mediaRecorderRef.current.stop();
    }

    // Stop all tracks
    [screenStreamRef.current, webcamStreamRef.current].forEach((stream) => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    });

    // Clean up video elements
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
    }
    if (webcamVideoRef.current) {
      webcamVideoRef.current.srcObject = null;
    }

    setRecording(false);
    setStatus("Recording stopped. Finishing uploads...");
  }, []);

  const toggleSection = useCallback((section) => {
    setOpenSection((prev) => (prev === section ? null : section));
    setOpenMediaIndex({
      photos: null,
      videos: null,
      recordings: null,
      reels: null,
      rec: null,
    });
  }, []);

  const toggleMedia = useCallback((section, index) => {
    setOpenMediaIndex((prev) => ({
      ...prev,
      [section]: prev[section] === index ? null : index,
    }));
  }, []);

  const retryPermissions = async () => {
    setPermissionError("");
    try {
      await requestPermissions();
    } catch (error) {
      setPermissionError("Failed to get permissions");
    }
  };

  return (
    <div
      className="app-container"
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#1a1a1a",
        color: "white",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px",
          backgroundColor: "#2a2a2a",
          borderBottom: "1px solid #444",
        }}
      >
        <h1
          style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "4px" }}
        >
          Screen Recorder
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "14px" }}>{status}</p>
            {permissionError && (
              <p style={{ fontSize: "12px", color: "#ef4444" }}>
                {permissionError}
              </p>
            )}
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div
                style={{
                  width: "100%",
                  height: "4px",
                  backgroundColor: "#444",
                  borderRadius: "2px",
                  marginTop: "4px",
                }}
              >
                <div
                  style={{
                    width: `${uploadProgress}%`,
                    height: "100%",
                    backgroundColor: "#3b82f6",
                    borderRadius: "2px",
                  }}
                ></div>
              </div>
            )}
          </div>
          {!permissionGranted ? (
            <button
              onClick={retryPermissions}
              style={{
                backgroundColor: "#3b82f6",
                color: "white",
                padding: "6px 12px",
                borderRadius: "4px",
                border: "none",
                cursor: "pointer",
                fontWeight: "bold",
                fontSize: "14px",
              }}
            >
              Grant Permissions
            </button>
          ) : recording ? (
            <button
              onClick={stopRecording}
              style={{
                backgroundColor: "#ef4444",
                color: "white",
                padding: "6px 12px",
                borderRadius: "4px",
                border: "none",
                cursor: "pointer",
                fontWeight: "bold",
                fontSize: "14px",
              }}
            >
              Stop Recording
            </button>
          ) : (
            <button
              onClick={startRecording}
              style={{
                backgroundColor: "#3b82f6",
                color: "white",
                padding: "6px 12px",
                borderRadius: "4px",
                border: "none",
                cursor: "pointer",
                fontWeight: "bold",
                fontSize: "14px",
              }}
            >
              Restart Recording
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
        }}
      >
        {/* Sidebar */}
        <div
          style={{
            width: "200px",
            backgroundColor: "#2a2a2a",
            padding: "10px",
            overflowY: "auto",
            borderRight: "1px solid #444",
          }}
        >
          {[
            { id: "notes", label: "Notes" },
            { id: "message", label: "Message" },
            { id: "photos", label: "Photos" },
            { id: "videos", label: "Videos" },
            { id: "recordings", label: "My Recordings" },
            { id: "rec", label: "Gola Recordings" },
            { id: "instagram", label: "Instagram" },
          ].map((item) => (
            <div
              key={item.id}
              onClick={() => toggleSection(item.id)}
              style={{
                padding: "10px",
                marginBottom: "4px",
                borderRadius: "4px",
                cursor: "pointer",
                backgroundColor:
                  openSection === item.id ? "#3b82f6" : "transparent",
                color: openSection === item.id ? "white" : "#e5e7eb",
                fontWeight: openSection === item.id ? "bold" : "normal",
                transition: "all 0.2s",
              }}
            >
              {item.label}
            </div>
          ))}
        </div>

        {/* Content Area */}
        <div
          style={{
            flex: 1,
            padding: "16px",
            overflowY: "auto",
            backgroundColor: "#1e1e1e",
          }}
        >
          {openSection === "notes" && (
            <div>
              {all.map((para, idx) => (
                <p
                  key={idx}
                  style={{ marginBottom: "16px", lineHeight: "1.5" }}
                >
                  {para}
                </p>
              ))}
            </div>
          )}
          {openSection === "message" && (
            <div>
              {allParagraphs.map((para, idx) => (
                <p
                  key={idx}
                  style={{ marginBottom: "16px", lineHeight: "1.5" }}
                >
                  {para}
                </p>
              ))}
            </div>
          )}

          {openSection === "photos" && (
            <div style={{ display: "grid", gap: "16px" }}>
              {images.map((image, idx) => (
                <div key={idx}>
                  <div
                    onClick={() => toggleMedia("photos", idx)}
                    style={{
                      padding: "10px",
                      backgroundColor:
                        openMediaIndex.photos === idx ? "#3b82f6" : "#2a2a2a",
                      borderRadius: "4px",
                      cursor: "pointer",
                      marginBottom: "8px",
                    }}
                  >
                    {image.title}
                  </div>
                  {openMediaIndex.photos === idx && (
                    <div style={{ textAlign: "center" }}>
                      <img
                        src={image.src}
                        alt={image.title}
                        style={{
                          maxWidth: "100%",
                          maxHeight: "400px",
                          borderRadius: "4px",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {openSection === "videos" && (
            <div style={{ display: "grid", gap: "16px" }}>
              {videos.map((video, idx) => (
                <div key={idx}>
                  <div
                    onClick={() => toggleMedia("videos", idx)}
                    style={{
                      padding: "10px",
                      backgroundColor:
                        openMediaIndex.videos === idx ? "#3b82f6" : "#2a2a2a",
                      borderRadius: "4px",
                      cursor: "pointer",
                      marginBottom: "8px",
                    }}
                  >
                    {video.title}
                  </div>
                  {openMediaIndex.videos === idx && (
                    <div
                      style={{
                        position: "relative",
                        paddingBottom: "56.25%", // 16:9 aspect ratio
                        height: 0,
                        overflow: "hidden",
                      }}
                    >
                      <iframe
                        title={video.title}
                        src={video.src}
                        allowFullScreen
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          border: "none",
                          borderRadius: "4px",
                        }}
                      ></iframe>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {openSection === "recordings" && (
            <div style={{ display: "grid", gap: "16px" }}>
              {sr.map((recording, idx) => (
                <div key={idx}>
                  <div
                    onClick={() => toggleMedia("recordings", idx)}
                    style={{
                      padding: "10px",
                      backgroundColor:
                        openMediaIndex.recordings === idx
                          ? "#3b82f6"
                          : "#2a2a2a",
                      borderRadius: "4px",
                      cursor: "pointer",
                      marginBottom: "8px",
                    }}
                  >
                    {recording.title}
                  </div>
                  {openMediaIndex.recordings === idx && (
                    <div
                      style={{
                        position: "relative",
                        paddingBottom: "56.25%", // 16:9 aspect ratio
                        height: 0,
                        overflow: "hidden",
                      }}
                    >
                      <iframe
                        title={recording.title}
                        src={recording.src}
                        allowFullScreen
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          border: "none",
                          borderRadius: "4px",
                        }}
                      ></iframe>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {openSection === "rec" && (
            <div style={{ display: "grid", gap: "16px" }}>
              {gola.map((rec, idx) => (
                <div key={idx}>
                  <div
                    onClick={() => toggleMedia("rec", idx)}
                    style={{
                      padding: "10px",
                      backgroundColor:
                        openMediaIndex.rec === idx ? "#3b82f6" : "#2a2a2a",
                      borderRadius: "4px",
                      cursor: "pointer",
                      marginBottom: "8px",
                    }}
                  >
                    {rec.title}
                  </div>
                  {openMediaIndex.rec === idx && (
                    <div
                      style={{
                        position: "relative",
                        paddingBottom: "56.25%", // 16:9 aspect ratio
                        height: 0,
                        overflow: "hidden",
                      }}
                    >
                      <iframe
                        title={rec.title}
                        src={rec.src}
                        allowFullScreen
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          border: "none",
                          borderRadius: "4px",
                        }}
                      ></iframe>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {openSection === "instagram" && (
            <div style={{ display: "grid", gap: "16px" }}>
              {instagramReels.map((reel, idx) => (
                <div key={idx}>
                  <div
                    onClick={() => toggleMedia("reels", idx)}
                    style={{
                      padding: "10px",
                      backgroundColor:
                        openMediaIndex.reels === idx ? "#3b82f6" : "#2a2a2a",
                      borderRadius: "4px",
                      cursor: "pointer",
                      marginBottom: "8px",
                    }}
                  >
                    {reel.title}
                  </div>
                  {openMediaIndex.reels === idx && (
                    <a
                      href={reel.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-block",
                        backgroundColor: "#3b82f6",
                        color: "white",
                        padding: "8px 16px",
                        borderRadius: "4px",
                        textDecoration: "none",
                        fontWeight: "bold",
                      }}
                    >
                      Watch Reel on Instagram
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
};

export default App;
