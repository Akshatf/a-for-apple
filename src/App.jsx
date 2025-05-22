import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { allParagraphs, images, videos, sr, gola, all, instagramReels } from './data';

const App = () => {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [recording, setRecording] = useState(false);
  const [videoURLs, setVideoURLs] = useState([]);
  const [status, setStatus] = useState('Ready to start...');
  const [openSection, setOpenSection] = useState(null);
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
  const uploadQueueRef = useRef([]);
  const isUploadingRef = useRef(false);
  const chunkIntervalRef = useRef(null);
  const screenVideoRef = useRef(null);
  const webcamVideoRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      clearInterval(chunkIntervalRef.current);
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = null;
      }
    };
  }, []);

  const requestPermissions = async () => {
    try {
      setStatus('Requesting camera and microphone permissions...');
      const webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 },
        audio: true,
      });
      webcamStreamRef.current = webcamStream;
      setPermissionGranted(true);
      setStatus('Camera/mic permissions granted. Ready to record!');
      return true;
    } catch (error) {
      setPermissionError('Camera/microphone access denied. Please grant permissions.');
      setStatus('Permission denied');
      console.error('Permission error:', error);
      return false;
    }
  };

  const startRecording = async () => {
    if (!permissionGranted) {
      const hasPermission = await requestPermissions();
      if (!hasPermission) return;
    }

    try {
      setStatus('Requesting screen sharing...');
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      screenStreamRef.current = screenStream;

      // Handle when user stops sharing screen
      screenStream.getVideoTracks()[0].onended = () => {
        setStatus('Screen sharing stopped by user');
        stopRecording();
      };

      // Setup canvas for compositing
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      // Create video elements
      const screenVideo = document.createElement('video');
      screenVideoRef.current = screenVideo;
      screenVideo.srcObject = screenStream;
      screenVideo.autoplay = true;
      screenVideo.playsInline = true;
      
      const webcamVideo = document.createElement('video');
      webcamVideoRef.current = webcamVideo;
      webcamVideo.srcObject = webcamStreamRef.current;
      webcamVideo.autoplay = true;
      webcamVideo.playsInline = true;

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
        
        webcamVideo.onloadedmetadata = () => {
          webcamReady = true;
          if (screenReady && webcamReady) resolve();
        };
        
        // Fallback in case metadata doesn't load
        setTimeout(resolve, 1000);
      });

      // Start the drawing loop
      const drawFrame = () => {
        try {
          // Clear canvas
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          // Only draw if the video is ready
          if (screenVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
            // Draw screen capture
            ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
            
            // Draw webcam overlay if ready
            if (webcamVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
              const webcamWidth = canvas.width / 5;
              const webcamHeight = (webcamVideo.videoHeight / webcamVideo.videoWidth) * webcamWidth;
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
          console.error('Drawing error:', error);
        }
      };

      // Start drawing before creating the stream
      drawFrame();

      // Small delay to ensure frames are being drawn
      await new Promise(resolve => setTimeout(resolve, 200));

      // Create mixed stream from canvas
      const mixedStream = canvas.captureStream(30);

      // Verify the stream has video tracks
      if (mixedStream.getVideoTracks().length === 0) {
        throw new Error('No video tracks in mixed stream');
      }

      // Mix audio sources if available
      try {
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        
        if (screenStream.getAudioTracks().length > 0) {
          const screenAudio = audioContext.createMediaStreamSource(
            new MediaStream([screenStream.getAudioTracks()[0]])
          );
          screenAudio.connect(destination);
        }
        
        if (webcamStreamRef.current.getAudioTracks().length > 0) {
          const micAudio = audioContext.createMediaStreamSource(
            new MediaStream([webcamStreamRef.current.getAudioTracks()[0]])
          );
          micAudio.connect(destination);
        }
        
        destination.stream.getAudioTracks().forEach(track => {
          mixedStream.addTrack(track);
        });
      } catch (audioError) {
        console.warn('Audio mixing failed:', audioError);
      }

      // Initialize MediaRecorder with supported mimeType
      const mimeTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4',
        ''
      ];
      
      const supportedType = mimeTypes.find(type => 
        type === '' || MediaRecorder.isTypeSupported(type)
      );
      
      const options = { mimeType: supportedType };

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
          const name = `recording-${new Date().toISOString()}-part-${chunkCounter}`;
          setVideoURLs(prev => [...prev, { url, name }]);
          addToUploadQueue(blob, name);
          setChunkCounter(prev => prev + 1);
        }
      };

      // Start recording
      recorder.start(1000); // Request data every second for safety
      setRecording(true);
      setStatus('Recording started...');

      // Set up chunking interval (4 minutes)
      chunkIntervalRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
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
      setStatus(`Error: ${error.message}`);
      console.error('Recording error:', error);
      stopRecording();
    }
  };

  const startNewChunk = () => {
    if (!screenStreamRef.current || !webcamStreamRef.current) return;

    try {
      const canvas = canvasRef.current;
      const mixedStream = canvas.captureStream(30);

      // Initialize MediaRecorder with supported mimeType
      const mimeTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4',
        ''
      ];
      
      const supportedType = mimeTypes.find(type => 
        type === '' || MediaRecorder.isTypeSupported(type)
      );
      
      const options = { mimeType: supportedType };

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
          const name = `recording-${new Date().toISOString()}-part-${chunkCounter}`;
          setVideoURLs(prev => [...prev, { url, name }]);
          addToUploadQueue(blob, name);
          setChunkCounter(prev => prev + 1);
        }
      };

      recorder.start(1000);
      setStatus(`Recording chunk ${chunkCounter + 1}...`);
    } catch (error) {
      console.error('Error starting new chunk:', error);
      stopRecording();
    }
  };

  const addToUploadQueue = (blob, name) => {
    uploadQueueRef.current.push({ blob, name });
    processUploadQueue();
  };

  const processUploadQueue = async () => {
    if (isUploadingRef.current || uploadQueueRef.current.length === 0) return;
    
    isUploadingRef.current = true;
    const { blob, name } = uploadQueueRef.current[0];
    
    try {
      await uploadToCloudinary(blob, name);
      uploadQueueRef.current.shift();
    } catch (error) {
      console.error('Upload failed, will retry:', error);
    } finally {
      isUploadingRef.current = false;
      
      if (uploadQueueRef.current.length > 0) {
        setTimeout(processUploadQueue, 1000);
      }
    }
  };

  const uploadToCloudinary = async (blob, name) => {
    return new Promise((resolve, reject) => {
      setStatus(`Uploading ${name}...`);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append('file', blob);
      formData.append('upload_preset', process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET || 'default_preset');
      formData.append('public_id', name);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${process.env.REACT_APP_CLOUDINARY_CLOUD_NAME || 'your_cloud_name'}/video/upload`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(progress);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setStatus(`${name} uploaded successfully!`);
          resolve();
        } else {
          setStatus(`Upload failed for ${name}`);
          reject(new Error(xhr.statusText));
        }
      };

      xhr.onerror = () => {
        setStatus(`Upload failed for ${name}`);
        reject(new Error('Network error'));
      };

      xhr.send(formData);
    });
  };

  const stopRecording = () => {
    clearInterval(chunkIntervalRef.current);
    
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.requestData();
      mediaRecorderRef.current.stop();
    }
    
    cancelAnimationFrame(animationFrameRef.current);
    
    // Stop all tracks
    [screenStreamRef.current, webcamStreamRef.current].forEach(stream => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
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
    setStatus('Recording stopped. Finishing uploads...');
  };

  const toggleSection = section => {
    setOpenMediaIndex({
      photos: null,
      videos: null,
      recordings: null,
      reels: null,
      rec: null,
    });
    setOpenSection(openSection === section ? null : section);
  };

  const toggleMedia = (section, index) => {
    setOpenMediaIndex(prev => ({
      ...prev,
      [section]: prev[section] === index ? null : index,
    }));
  };

  const retryPermissions = async () => {
    setPermissionError('');
    try {
      const webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 },
        audio: true,
      });
      setPermissionGranted(true);
      setStatus('Permissions granted. Waiting for recording to start...');
      webcamStreamRef.current = webcamStream;
    } catch (error) {
      setPermissionError('Camera and microphone access denied. Please grant permissions to view content and record.');
      setStatus('Permission denied');
      console.error('Permission error:', error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 text-white">
      <h1 className="text-2xl font-bold mb-4">Screen Recorder</h1>
      <p className="mb-4">{status}</p>
      
      {uploadProgress > 0 && uploadProgress < 100 && (
        <div className="w-full bg-gray-700 rounded-full h-2.5 mb-4">
          <div 
            className="bg-blue-600 h-2.5 rounded-full" 
            style={{ width: `${uploadProgress}%` }}
          ></div>
        </div>
      )}
      
      <canvas ref={canvasRef} className="hidden" />
      
      {!permissionGranted ? (
        <div className="mb-4">
          <p className="text-red-500">{permissionError}</p>
          <button
            onClick={retryPermissions}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mt-2"
          >
            Grant Permissions
          </button>
        </div>
      ) : (
        <>
          {!recording ? (
            <button
              onClick={startRecording}
              className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded mb-4"
            >
              Start Recording
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded mb-4"
            >
              Stop Recording
            </button>
          )}
          
          <div>
            <h2
              className="cursor-pointer bg-gray-800 p-3 rounded-lg mb-2"
              onClick={() => toggleSection('notes')}
            >
              Notes
            </h2>
            {openSection === 'notes' && (
              <div className="section mb-8">
                {all.map((para, idx) => (
                  <p key={idx} className="mb-4">{para}</p>
                ))}
              </div>
            )}
            
            <h2
              className="cursor-pointer bg-gray-800 p-3 rounded-lg mb-2"
              onClick={() => toggleSection('message')}
            >
              Message
            </h2>
            {openSection === 'message' && (
              <div className="section mb-8">
                {allParagraphs.map((para, idx) => (
                  <p key={idx} className="mb-4">{para}</p>
                ))}
              </div>
            )}
            
            <h2
              className="cursor-pointer bg-gray-800 p-3 rounded-lg mb-2"
              onClick={() => toggleSection('photos')}
            >
              Photos
            </h2>
            {openSection === 'photos' && (
              <div className="section mb-8">
                {images.map((image, idx) => (
                  <div key={idx} className="mb-4">
                    <h3
                      className="cursor-pointer bg-gray-800 p-3 rounded-lg"
                      onClick={() => toggleMedia('photos', idx)}
                    >
                      {image.title}
                    </h3>
                    {openMediaIndex.photos === idx && (
                      <div className="image-container mt-2">
                        <img src={image.src} alt={image.title} className="max-w-full h-auto" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            <h2
              className="cursor-pointer bg-gray-800 p-3 rounded-lg mb-2"
              onClick={() => toggleSection('instagram')}
            >
              Instagram
            </h2>
            {openSection === 'instagram' && (
              <div className="section mb-8">
                {instagramReels.map((reel, idx) => (
                  <div key={idx} className="mb-4">
                    <h3
                      className="cursor-pointer bg-gray-800 p-3 rounded-lg"
                      onClick={() => toggleMedia('reels', idx)}
                    >
                      {reel.title}
                    </h3>
                    {openMediaIndex.reels === idx && (
                      <a
                        href={reel.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mt-2"
                      >
                        Watch Reel
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            <h2
              className="cursor-pointer bg-gray-800 p-3 rounded-lg mb-2"
              onClick={() => toggleSection('videos')}
            >
              Videos
            </h2>
            {openSection === 'videos' && (
              <div className="section mb-8">
                {videos.map((video, idx) => (
                  <div key={idx} className="video-block mb-4">
                    <h3
                      className="cursor-pointer bg-gray-800 p-3 rounded-lg"
                      onClick={() => toggleMedia('videos', idx)}
                    >
                      {video.title}
                    </h3>
                    {openMediaIndex.videos === idx && (
                      <iframe
                        title={video.title}
                        src={video.src}
                        allowFullScreen
                        className="w-full h-[315px] rounded-lg"
                      ></iframe>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            <h2
              className="cursor-pointer bg-gray-800 p-3 rounded-lg mb-2"
              onClick={() => toggleSection('recordings')}
            >
              Recordings - Me
            </h2>
            {openSection === 'recordings' && (
              <div className="section mb-8">
                {sr.map((recording, idx) => (
                  <div key={idx} className="video-block mb-4">
                    <h3
                      className="cursor-pointer bg-gray-800 p-3 rounded-lg"
                      onClick={() => toggleMedia('recordings', idx)}
                    >
                      {recording.title}
                    </h3>
                    {openMediaIndex.recordings === idx && (
                      <iframe
                        title={recording.title}
                        src={recording.src}
                        allowFullScreen
                        className="w-full h-[315px] rounded-lg"
                      ></iframe>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            <h2
              className="cursor-pointer bg-gray-800 p-3 rounded-lg mb-2"
              onClick={() => toggleSection('rec')}
            >
              Recordings - Gola
            </h2>
            {openSection === 'rec' && (
              <div className="section mb-8">
                {gola.map((rec, idx) => (
                  <div key={idx} className="video-block mb-4">
                    <h3
                      className="cursor-pointer bg-gray-800 p-3 rounded-lg"
                      onClick={() => toggleMedia('rec', idx)}
                    >
                      {rec.title}
                    </h3>
                    {openMediaIndex.rec === idx && (
                      <iframe
                        title={rec.title}
                        src={rec.src}
                        allowFullScreen
                        className="w-full h-[315px] rounded-lg"
                      ></iframe>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            <p className="mt-8 text-red-500">
              Open at own risk -- Even I forgot when I made this
            </p>
            <a
              href="https://chipper-smakager-fb2485.netlify.app/"
              rel="noopener noreferrer"
              className="inline-block bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mt-2"
            >
              Click Me
            </a>
          </div>
          
          {videoURLs.length > 0 && (
            <div className="mt-8">
              <h2 className="text-xl font-bold mb-4">Recorded Chunks</h2>
              <div className="grid gap-4">
                {videoURLs.map((video, idx) => (
                  <div key={idx} className="border rounded-lg p-4">
                    <h3 className="font-semibold mb-2">{video.name}</h3>
                    <video 
                      src={video.url} 
                      controls 
                      className="w-full rounded-lg"
                    />
                    <a
                      href={video.url}
                      download={`${video.name}.webm`}
                      className="inline-block mt-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                    >
                      Download
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default App;