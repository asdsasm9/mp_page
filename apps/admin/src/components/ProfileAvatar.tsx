/**
 * Round avatar of the Instagram profile preview: the uploaded 480 px picture, else the initials (also when the picture
 * fails to load, e.g. the file is gone). Decorative, so no alt text.
 */
import { profileInitials } from '@mp/shared';
import { useState } from 'react';
import { avatarImgProps } from '../data/images';

interface Props {
  profile: { display_name: string; username: string; avatar_key: string | null };
  imgBase: string;
  /** A picture that is not on the image host yet (the object URL of the just picked file); wins over the key. */
  previewSrc?: string | null;
}

export function ProfileAvatar({ profile, imgBase, previewSrc = null }: Props) {
  const img = profile.avatar_key ? avatarImgProps(imgBase, profile.avatar_key) : null;
  const [failed, setFailed] = useState<string | null>(null);
  if (previewSrc) {
    return <img className="ig-avatar" src={previewSrc} width={480} height={480} alt="" decoding="async" />;
  }
  if (img && failed !== img.src) {
    return <img className="ig-avatar" {...img} alt="" decoding="async" onError={() => setFailed(img.src)} />;
  }
  return (
    <span className="ig-avatar ig-avatar-initials" aria-hidden="true">
      {profileInitials(profile)}
    </span>
  );
}
