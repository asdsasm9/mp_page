$(document).ready(function () {
  $(".nav-toggler").each(function (_, navToggler) {
    var target = $(navToggler).data("target");
    $(navToggler).on("click", function () {
      $(target).animate({
        height: "toggle",
      });
    });
  });
  
  var urlParams;
  (window.onpopstate = function () {
      var match,
          pl     = /\+/g,  // Regex for replacing addition symbol with a space
          search = /([^&=]+)=?([^&]*)/g,
          decode = function (s) { return decodeURIComponent(s.replace(pl, " ")); },
          query  = window.location.search.substring(1);

      urlParams = {};
      while (match = search.exec(query))
        urlParams[decode(match[1])] = decode(match[2]);
  })();

  var typ = urlParams["site"];
  portfolio_part(typ);

  
});

$(document).scroll(function() {
  var y = $(this).scrollTop();
  if (y > 400) {
    $('.move_up_btn').fadeIn();
  } else {
    $('.move_up_btn').fadeOut();
  }
});

function move_up(){
  $('html, body').animate({
    scrollTop: 0
  }, 800);
}


function portfolio_part(i) {
  $(document).scrollTop(0);
  var x = document.getElementById("svadby");
  var y = document.getElementById("portrety");
  var z = document.getElementById("produkty");
  var xx = document.getElementById("svadby_btn");
  var yy = document.getElementById("portrety_btn");
  var zz = document.getElementById("produkty_btn");
  x.style.display = "none";
  y.style.display = "none";
  z.style.display = "none";
  xx.style.textDecoration = "none";
  yy.style.textDecoration = "none";
  zz.style.textDecoration = "none";

  if (i === "portrety") {
    yy.style.textDecoration = "underline overline";
    y.style.display = "block";
  }
  if (i === "produkty") {
    zz.style.textDecoration = "underline overline";
    z.style.display = "block";
  }
  if (i === "svadby" || i === undefined) {
    xx.style.textDecoration = "underline overline";
    x.style.display = "block";
  }
  
}