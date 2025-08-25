import type { ReactElement } from "react";

const Hello = () => {
  return (
    <p>
      hello world. This is for example purposes only, showing legacy usages of
      the pages router. Use the app router instead.
    </p>
  );
};

Hello.getLayout = function getLayout(page: ReactElement) {
  return { page };
};

export default Hello;
