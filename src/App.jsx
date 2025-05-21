import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { Analytics } from "@vercel/analytics/next"
import { allParagraphs, images, videos, sr, gola, all, instagramReels } from './data';

const App = () => {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [recording, setRecording] = useState(false);
  const [videoURL, setVideoURL] = useState('');
  const [status, setStatus] = useState('Requesting permissions...');
  const [openSection, setOpenSection] = useState(null);
  const [openMediaIndex, setOpenMediaIndex] = useState({
    photos: null,
    videos: null,
    recordings: null,
    reels: null,
    rec: null,
  });
  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const animationFrameRef = useRef(null);
  const screenStreamRef = useRef(null);
  const webcamStreamRef = useRef(null);

  // Request permissions on mount
  useEffect(() => {
    const requestPermissions = async () => {
      try {
        const webcamStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 },
          audio: true,
        });
        setPermissionGranted(true);
        setStatus('Permissions granted. Waiting for recording to start...');
        webcamStreamRef.current = webcamStream;
        startRecording();
      } catch (error) {
        setPermissionError('Camera and microphone access denied. Please grant permissions to view content and record.');
        setStatus('Permission denied');
        console.error('Permission error:', error);
      }
    };
    requestPermissions();
    return () => stopRecording();
  }, []);

  const startRecording = async () => {
    try {
      setStatus('Requesting screen access...');
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      screenStreamRef.current = screenStream;

      const screenVideo = document.createElement('video');
      screenVideo.srcObject = screenStream;
      screenVideo.muted = true;
      await screenVideo.play();

      const webcamVideo = document.createElement('video');
      webcamVideo.srcObject = webcamStreamRef.current;
      webcamVideo.muted = true;
      await webcamVideo.play();

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const targetWidth = 1280;
      const aspectRatio = screenVideo.videoHeight / screenVideo.videoWidth;
      canvas.width = targetWidth;
      canvas.height = targetWidth * aspectRatio;

      const drawFrame = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
        const webcamWidth = canvas.width / 5;
        const webcamHeight = (webcamVideo.videoHeight / webcamVideo.videoWidth) * webcamWidth;
        ctx.drawImage(
          webcamVideo,
          canvas.width - webcamWidth - 20,
          canvas.height - webcamHeight - 20,
          webcamWidth,
          webcamHeight
        );
        ctx.font = '24px Arial';
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.textAlign = 'left';
        // ctx.strokeText('Recording...', 20, 40);
        // ctx.fillText('Recording...', 20, 40);
        // ctx.strokeText('My name is Akshat', 20, 80);
        // ctx.fillText('My name is Akshat', 20, 80);
        animationFrameRef.current = requestAnimationFrame(drawFrame);
      };

      drawFrame();
      const mixedStream = canvas.captureStream(30);
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      const sources = [];
      if (screenStream.getAudioTracks().length) {
        const screenAudio = audioContext.createMediaStreamSource(
          new MediaStream([screenStream.getAudioTracks()[0]])
        );
        sources.push(screenAudio);
      }
      if (webcamStreamRef.current.getAudioTracks().length) {
        const micAudio = audioContext.createMediaStreamSource(
          new MediaStream([webcamStreamRef.current.getAudioTracks()[0]])
        );
        sources.push(micAudio);
      }
      sources.forEach(src => src.connect(destination));
      destination.stream.getAudioTracks().forEach(track => mixedStream.addTrack(track));

      let recorder;
      try {
        recorder = new MediaRecorder(mixedStream, { mimeType: 'video/webm; codecs=vp9' });
      } catch {
        recorder = new MediaRecorder(mixedStream, { mimeType: 'video/webm; codecs=vp8' });
      }
      const chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        cancelAnimationFrame(animationFrameRef.current);
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setVideoURL(url);
        await uploadToCloudinary(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setStatus('Recording screen + webcam...');
    } catch (error) {
      setStatus(`Error: ${error.message}`);
      console.error('Recording error:', error);
      stopRecording();
    }
  };

  const uploadToCloudinary = async (blob) => {
    try {
      setStatus('Uploading to Cloudinary...');
      const formData = new FormData();
      formData.append('file', blob);
      formData.append('upload_preset', process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET || 'YOUR_CLOUDINARY_UPLOAD_PRESET');
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${process.env.REACT_APP_CLOUDINARY_CLOUD_NAME || 'YOUR_CLOUDINARY_CLOUD_NAME'}/video/upload`,
        { method: 'POST', body: formData }
      );
      const data = await response.json();
      if (data.secure_url) {
        setStatus(`Upload complete! URL: ${data.secure_url}`);
        console.log('Cloudinary upload success:', data);
      } else {
        setStatus('Upload failed');
        console.error('Cloudinary upload error:', data);
      }
    } catch (error) {
      setStatus('Upload failed');
      console.error('Cloudinary upload error:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop();
    }
    cancelAnimationFrame(animationFrameRef.current);
    [screenStreamRef.current, webcamStreamRef.current].forEach(stream => {
      stream?.getTracks().forEach(track => track.stop());
    });
    setRecording(false);
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
      startRecording();
    } catch (error) {
      setPermissionError('Camera and microphone access denied. Please grant permissions to view content and record.');
      setStatus('Permission denied');
      console.error('Permission error:', error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 text-white">
      <h1 className="text-2xl font-bold mb-4">App</h1>
      <p className="mb-4">{status}</p>
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
          {recording && (
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
                        <img src={image.src} alt={image.title} />
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
          {videoURL && (
            <div className="mt-8">
              <h2 className="text-xl font-bold">Recording Complete</h2>
              <video src={videoURL} controls className="w-full rounded-lg mt-2" />
            </div>
          )}
        </>
      )}
      <Analytics />
    </div>
  );
};

export default App;