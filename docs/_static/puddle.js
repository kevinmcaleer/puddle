// Screenshots are shown at the page's width; clicking one opens it at full size.
document.addEventListener('DOMContentLoaded', () => {
  for (const img of document.querySelectorAll('article img')) {
    if (img.closest('a')) continue;
    const link = document.createElement('a');
    link.href = img.src;
    link.title = 'Open full size';
    img.replaceWith(link);
    link.append(img);
  }
});
