import "./App.css";
import AppComponent from "./components/AppComponent";

import ReactGA from "react-ga";

function App() {
  ReactGA.initialize("G-7QEZCZ09WY");

  return <AppComponent />;
}

export default App;
