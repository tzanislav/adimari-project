import React, { useState, useEffect } from 'react';
import { ReactImageTurntable } from 'react-image-turntable';
import type { ReactImageTurntableProps } from 'react-image-turntable';
import './Turntable.css';

function App(props: Partial<ReactImageTurntableProps>) {
  const [imageUrls, setImageUrls] = useState<string[]>([]);

  useEffect(() => {
    const urls = Array.from({ length: 35 }, (_, i) =>
      `https://adimariweb.s3.eu-west-1.amazonaws.com/Turntable/turn+(${i + 1}).png`
    );
    setImageUrls(urls.reverse());
  }, []);

  const [rotationDisabled, setRotationDisabled] = useState(false);

  const handleKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (rotationDisabled) return;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      setRotationDisabled(true);
    }
  };

  return (
    <ReactImageTurntable
      className='turntable'
      images={imageUrls}
      autoRotate={{ disabled: rotationDisabled, interval: 1500 }}
      onPointerDown={() => setRotationDisabled(true)}
      onPointerUp={() => setRotationDisabled(true)}
      onKeyDown={handleKeyDown}
      onKeyUp={() => setRotationDisabled(false)}
      {...props}
    />
  );
}

export default App;
