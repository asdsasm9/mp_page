import { useEffect } from "react";

const usePageTitle = (title: string) => {
  useEffect(() => {
    document.title = `${title} | MullnyPhotos`;
  }, [title]);
};

export default usePageTitle;
