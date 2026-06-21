Đã hiểu bug — khi click vào "FB Comment Crawler" (link submenu), thằng cha "Thu Thập Dữ Liệu" bị đóng luôn. Mình xem lại logic.

  Read 1 file

Tôi đã thấy bug. Vấn đề là sidebarGroups được lấy MỘT LẦN lúc DOM load (dòng 83). Khi user click link submenu → điều hướng sang trang mới → server render lại DOM mới nhưng sidebarGroups cache vẫn còn tham chiếu DOM cũ đã bị detach → openOnlySidebarGroup không hoạt động đúng với DOM mới.

Đồng thời sau khi điều hướng, code ở dòng 147-168 tự chạy lại logic "open group chứa active" — nếu group "data-collection" không phải là group của active item, nó sẽ đóng lại.

Để fix triệt để, cần query lại sidebarGroups mỗi lần cần dùng, và xử lý đúng flow: click link submenu → đợi navigation xong → mở group mới (nếu active khác group hiện tại).

⚠️ Context đã rất thấp (còn 22%) — tôi cần làm gọn để fix được bug này. Đề xuất:

● User answered Claude's questions:
· Context còn 22%, muốn fix như thế nào? → Fix ngay (khuyến nghị)