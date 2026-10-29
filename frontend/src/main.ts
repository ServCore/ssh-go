import { createApp } from "vue";
import Button from "@arco-design/web-vue/es/button";
import "@arco-design/web-vue/es/button/style/css.js";
import App from "./App.vue";
import "./styles.css";
import "./themes.css";
import "./motion.css";
import { initializeAppearance } from "./composables/appearance";

const stopAppearance = initializeAppearance();
if (import.meta.hot) import.meta.hot.dispose(stopAppearance);
const app = createApp(App);
app.use(Button);
app.mount("#root");
