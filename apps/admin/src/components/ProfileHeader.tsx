/**
 * Profile header of the Instagram preview (WP-15, D5): avatar (centre-cropped photo or initials), username as h2,
 * counts as a list with visible words, name, bio, link, the button row and the tab row. The link is plain text (never an
 * anchor); "Upravit profil" (T-364, opens the edit dialog) is the one working button, the archive and share shapes and
 * the tabs are aria-hidden. All values are typed by hand and rendered as React text (no linkify). The post count is
 * derived from the posts that are shown.
 */
import { defaultIgProfile, formatProfileCount, type IgProfileRow } from '@mp/shared';
import { useState } from 'react';
import { useCanMutate } from '../data/health';
import { cs } from '../i18n/cs';
import { EditProfileDialog } from '../screens/ProfileDialog';
import { ProfileAvatar } from './ProfileAvatar';

type Shown = Pick<IgProfileRow, 'username' | 'display_name' | 'bio' | 'link' | 'followers_count' | 'following_count' | 'avatar_photo_id'>;

interface Props {
  /** The loaded profile; `null` when the profile could not be loaded (defaults are shown instead). */
  profile: Shown | null;
  /** Number of posts the preview shows right now. */
  postCount: number;
  imgBase: string;
}

const ICON = { viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': true, focusable: false } as const;

export function ProfileHeader({ profile, postCount, imgBase }: Props) {
  const p = profile ?? defaultIgProfile;
  const t = cs.instagram.profile;
  const canMutate = useCanMutate();
  const [editing, setEditing] = useState(false);
  return (
    <div className="ig-profile">
      <h2 className="ig-username">{p.username}</h2>
      <div className="ig-profile-top">
        <ProfileAvatar profile={p} imgBase={imgBase} />
        <ul className="ig-counts" aria-label={t.countsLabel}>
          <li>
            <strong>{formatProfileCount(postCount)}</strong> <span>{t.posts}</span>
          </li>
          <li>
            <strong>{formatProfileCount(p.followers_count)}</strong> <span>{t.followers}</span>
          </li>
          <li>
            <strong>{formatProfileCount(p.following_count)}</strong> <span>{t.following}</span>
          </li>
        </ul>
      </div>
      {p.display_name ? <p className="ig-name">{p.display_name}</p> : null}
      {p.bio ? <p className="ig-bio">{p.bio}</p> : null}
      {p.link ? <p className="ig-profile-link">{p.link}</p> : null}
      <div className="ig-actions">
        {/* The one working button: off while the profile could not be loaded (nothing to edit) or while offline. */}
        <button type="button" className="button ig-edit" disabled={profile === null || !canMutate} onClick={() => setEditing(true)}>
          {t.edit}
        </button>
        <span className="ig-fake-button" aria-hidden="true">
          {t.archive}
        </span>
        <span className="ig-fake-button ig-fake-icon" aria-hidden="true">
          <svg {...ICON}>
            <path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      <div className="ig-tabs" aria-hidden="true">
        <span className="ig-tab ig-tab-active">
          <svg {...ICON}>
            <path d="M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </span>
        <span className="ig-tab">
          <svg {...ICON}>
            <path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 9h16M10 15v-3l3 1.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="ig-tab">
          <svg {...ICON}>
            <path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM12 9.5a2 2 0 1 0 0 .01M8 17c.5-2 2-3 4-3s3.5 1 4 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
      </div>
      {editing && profile !== null ? <EditProfileDialog onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
