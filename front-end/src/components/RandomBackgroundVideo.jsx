import { useState } from 'react';

/* This project does not use runtime PropTypes; className is the component's styling hook. */
/* eslint-disable react/prop-types */

const backgroundVideos = [
  '/background-videos/background-15191845-hd_1920_1080_60fps.mp4',
  '/background-videos/background-4840592-uhd_3840_2160_25fps.mp4',
  '/background-videos/background-7181489-uhd_3840_2160_30fps.mp4',
  '/background-videos/background-7304865-uhd_4096_1974_30fps.mp4',
  '/background-videos/background-8558509-uhd_4096_2160_25fps.mp4',
  '/background-videos/home_Back.mp4',
];

function RandomBackgroundVideo({ className }) {
  const [source] = useState(() => (
    backgroundVideos[Math.floor(Math.random() * backgroundVideos.length)]
  ));

  return (
    <video className={className} autoPlay muted loop playsInline aria-hidden="true">
      <source src={source} type="video/mp4" />
    </video>
  );
}

export default RandomBackgroundVideo;
