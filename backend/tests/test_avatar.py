from app.avatar import clean_avatar


def test_old_three_number_avatars_become_male_with_default_hair() -> None:
    assert clean_avatar([3, 4, 5]) == [3, 4, 5, 0, 0]


def test_values_are_clamped_to_each_slot() -> None:
    assert clean_avatar([99, -1, 7, 5, 9]) == [7, 0, 7, 1, 3]
