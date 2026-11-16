/** Round avatar of the Instagram profile preview: the centre-cropped photo, else the initials. Decorative, so no alt text. */
import { profileInitials } from '@mp/shared';
import { photoImgProps } from '../data/images';

interface Props {
  profile: { display_name: string; username: string; avatar_photo_id: string | null };
  imgBase: string;
}

export function ProfileAvatar({ profile, imgBase }: Props) {
  const img = profile.avatar_photo_id ? photoImgProps(imgBase, profile.avatar_photo_id, 'avatar') : null;
  if (img) {
    return <img className="ig-avatar" {...img} width={480} height={480} alt="" decoding="async" />;
  }
  return (
    <span className="ig-avatar ig-avatar-initials" aria-hidden="true">
      {profileInitials(profile)}
    </span>
  );
}
