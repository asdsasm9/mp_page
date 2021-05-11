$(document).ready(function () {
  portfolio_part(1);
  $(".nav-toggler").each(function (_, navToggler) {
    var target = $(navToggler).data("target");
    $(navToggler).on("click", function () {
      $(target).animate({
        height: "toggle",
      });
    });
  });
});
function portfolio_part(i) {
  var x = document.getElementById("svadby");
  var y = document.getElementById("portrety");
  var z = document.getElementById("produktovky");
  var xx = document.getElementById("svadby_btn");
  var yy = document.getElementById("portrety_btn");
  var zz = document.getElementById("produktovky_btn");
  x.style.display = "none";
  y.style.display = "none";
  z.style.display = "none";
  xx.style.textDecoration = "none";
  yy.style.textDecoration = "none";
  zz.style.textDecoration = "none";

  if (i === 1) {
    xx.style.textDecoration = "underline overline";
    x.style.display = "block";
  }
  if (i === 2) {
    yy.style.textDecoration = "underline overline";
    y.style.display = "block";
  }
  if (i === 3) {
    zz.style.textDecoration = "underline overline";
    z.style.display = "block";
  }
}