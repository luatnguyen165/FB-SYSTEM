// Script to generate sample WAV audio files for Trend Music
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, '..', 'public', 'music', 'tracks');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Sample songs metadata
const songs = [
    { title: 'Sunset Dreams', artist: 'Luna Wave', duration: 30, freq: 440 },
    { title: 'Neon Nights', artist: 'Cyber Pulse', duration: 30, freq: 523 },
    { title: 'Ocean Breeze', artist: 'Coral Reef', duration: 30, freq: 587 },
    { title: 'Midnight Run', artist: 'Urban Beats', duration: 30, freq: 659 },
    { title: 'Starlight', artist: 'Cosmic Drift', duration: 30, freq: 698 },
    { title: 'Electric Soul', artist: 'Neon Heart', duration: 30, freq: 784 },
    { title: 'Golden Hour', artist: 'Sunset Blvd', duration: 30, freq: 880 },
    { title: 'Deep Focus', artist: 'Ambient Mind', duration: 30, freq: 440 },
];

// Generate simple WAV file (sine wave tone)
function generateWav(filename, frequency, durationSec, sampleRate = 22050) {
    const numSamples = sampleRate * durationSec;
    const buffer = Buffer.alloc(44 + numSamples * 2);
    
    // WAV Header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + numSamples * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // chunk size
    buffer.writeUInt16LE(1, 20);  // PCM format
    buffer.writeUInt16LE(1, 22);  // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buffer.writeUInt16LE(2, 32);  // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(numSamples * 2, 40);
    
    // Generate sine wave with envelope
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        // Envelope (fade in/out)
        let envelope = 1.0;
        const fadeLen = Math.min(sampleRate * 0.1, numSamples * 0.1);
        if (i < fadeLen) envelope = i / fadeLen;
        if (i > numSamples - fadeLen) envelope = (numSamples - i) / fadeLen;
        
        // Combine multiple harmonics for richer sound
        const sample = Math.sin(2 * Math.PI * frequency * t) * 0.3 * envelope
            + Math.sin(2 * Math.PI * frequency * 0.5 * t) * 0.15 * envelope
            + Math.sin(2 * Math.PI * frequency * 1.5 * t) * 0.1 * envelope;
        
        const val = Math.max(-1, Math.min(1, sample));
        const intVal = Math.floor(val * 32767);
        buffer.writeInt16LE(intVal, 44 + i * 2);
    }
    
    fs.writeFileSync(filename, buffer);
}

// Generate all songs
const tracks = [];
songs.forEach((song, index) => {
    const filename = `track${String(index + 1).padStart(2, '0')}.wav`;
    const filepath = path.join(outputDir, filename);
    console.log(`Generating: ${song.title} by ${song.artist} -> ${filename}`);
    generateWav(filepath, song.freq, song.duration);
    tracks.push({
        id: index + 1,
        title: song.title,
        artist: song.artist,
        file: `/music/tracks/${filename}`,
        duration: song.duration,
        cover: null
    });
});

// Save tracks metadata as JSON
const metadataPath = path.join(__dirname, '..', 'public', 'music', 'tracks.json');
fs.writeFileSync(metadataPath, JSON.stringify(tracks, null, 2));
console.log(`\n✅ Generated ${tracks.length} tracks!`);
console.log(`Metadata saved to: ${metadataPath}`);