import { mountBook } from "../src";

mountBook(document.querySelector("canvas")!, {
  leaves: 6,
  title: "MY BOOK",
  texturesUrl: "../textures/book-pattern/", // this page lives one folder down
  paintFace(g, width, height, { face }) {
    g.font = `${width / 14}px Georgia`;
    g.fillText(`Page ${face + 1}`, width * 0.12, height * 0.14);
  },
});
