class Car {
    public year: i32

    public constructor(year: i32) {
        this.year = year
    }
}

let car = new Car(2030)

print(car.year)
