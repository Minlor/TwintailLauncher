import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';

export default function TTLVersion() {
    const [version, setVersion] = useState('');
    const branch = import.meta.env.MODE || "unknown";
    useEffect(() => {
        getVersion().then(setVersion);
    }, []);
    return (
        <span className="text-zinc-300">
            Version: <span className={"text-purple-400 font-bold"}>{version}</span> | Branch: <span className={"text-orange-400 font-bold"}>{branch}</span> | Commit: <span className={"text-cyan-400 font-bold"}>{__COMMIT_HASH__}</span>
        </span>
    );
}
